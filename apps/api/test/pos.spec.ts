import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const run = Date.now().toString(36);
const slugA = `pa-${run}`;
const slugB = `pb-${run}`;

describe('point of sale', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const as = (slug: string, token = () => tokens[slug]) => {
    const r = () => request(app.getHttpServer());
    const auth = (t: request.Test) => t.set('X-Tenant', slug).set('Authorization', `Bearer ${token()}`);
    return {
      get: (url: string) => auth(r().get(url)),
      post: (url: string, body: object = {}) => auth(r().post(url)).send(body),
      patch: (url: string, body: object = {}) => auth(r().patch(url)).send(body),
    };
  };
  const A = () => as(slugA);
  const B = () => as(slugB);
  let cashier: ReturnType<typeof as>;
  let register: { id: string; warehouseId: string; pricesIncludeTax: boolean; tax: { rate: string } };
  let session: string;
  let soap: string;
  let wrap: string;
  let firstSale: string;

  const balances = async () => {
    const list = (await A().get('/accounts').expect(200)).body as { code: string; balance: string }[];
    return Object.fromEntries(list.filter((a) => a.balance !== '0').map((a) => [a.code, a.balance]));
  };
  const onHand = async (productId: string) => {
    const levels = (await A().get(`/stock/levels?productId=${productId}`).expect(200)).body;
    const rows = Array.isArray(levels) ? levels : levels.items;
    return rows.filter((l: { productId?: string; product?: { id: string } }) => (l.productId ?? l.product?.id) === productId).reduce((a: number, l: { quantity: string }) => a + Number(l.quantity), 0);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    for (const slug of [slugA, slugB]) {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ companyName: `Shop ${slug}`, slug, name: 'Owner', email: `owner@${slug}.test`, password: 'password123' })
        .expect(201);
      tokens[slug] = res.body.token;
    }
    await A().post('/users', { name: 'Cashier', email: 'cashier@a.test', password: 'password123' }).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/login').set('X-Tenant', slugA).send({ email: 'cashier@a.test', password: 'password123' });
    cashier = as(slugA, () => login.body.token);

    const pcs = (await A().get('/units')).body.find((u: { code: string }) => u.code === 'pcs').id;
    soap = (await A().post('/products', { name: 'Soap', sku: 'SOAP', barcode: '8964000000017', unitId: pcs, salePrice: 118, cost: 60 }).expect(201)).body.id;
    wrap = (await A().post('/products', { name: 'Gift wrap', type: 'SERVICE', unitId: pcs, salePrice: 59 }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('gives each company a main register on its first warehouse', async () => {
    const list = (await A().get('/pos/registers').expect(200)).body;
    expect(list).toHaveLength(1);
    register = list[0];
    expect(register).toMatchObject({ name: 'Main register', pricesIncludeTax: true });
    expect(register.tax.rate).toBe('18');
    await A().post('/stock/moves', { kind: 'RECEIPT', productId: soap, warehouseId: register.warehouseId, quantity: 20, unitCost: 60 }).expect(201);
    expect((await B().get('/pos/registers')).body[0].id).not.toBe(register.id);
  });

  it('opens one session per register', async () => {
    const s = await cashier.post('/pos/sessions', { registerId: register.id, openingCash: 1000 }).expect(201);
    expect(s.body.number).toBe('SHIFT-00001');
    session = s.body.id;
    await A().post('/pos/sessions', { registerId: register.id, openingCash: 0 }).expect(409);
    await B().get(`/pos/sessions/${session}`).expect(404);
  });

  it('finds products by name or barcode with stock on hand', async () => {
    const byBarcode = (await cashier.get(`/pos/sessions/${session}/products?q=8964000000017`).expect(200)).body;
    expect(byBarcode).toHaveLength(1);
    expect(byBarcode[0]).toMatchObject({ name: 'Soap', onHand: '20' });
    const all = (await cashier.get(`/pos/sessions/${session}/products`).expect(200)).body;
    expect(all.find((p: { id: string }) => p.id === wrap).onHand).toBeNull();
  });

  it('sells with tax-inclusive prices and gives change from cash', async () => {
    const res = await cashier
      .post('/pos/orders', { sessionId: session, lines: [{ productId: soap, quantity: 2 }, { productId: wrap, quantity: 1 }], payments: [{ method: 'CASH', amount: 500 }] })
      .expect(201);
    expect(res.body).toMatchObject({ number: 'POS-00001', subtotal: '250', taxTotal: '45', total: '295', tendered: '500', change: '205' });
    expect(res.body.lines[0]).toMatchObject({ subtotal: '200', taxAmount: '36', total: '236' });
    expect(res.body.payments).toEqual([expect.objectContaining({ method: 'CASH', amount: '295' })]);
    firstSale = res.body.id;
    expect(await onHand(soap)).toBe(18);
  });

  it('splits payments between card and cash', async () => {
    const res = await cashier
      .post('/pos/orders', { sessionId: session, lines: [{ productId: soap, quantity: 1, discountPct: 10 }], payments: [{ method: 'CARD', amount: 50, reference: 'AUTH-1' }, { method: 'CASH', amount: 100 }] })
      .expect(201);
    expect(res.body).toMatchObject({ subtotal: '90', taxTotal: '16.2', total: '106.2', change: '43.8' });
    const paid = Object.fromEntries(res.body.payments.map((p: { method: string; amount: string }) => [p.method, p.amount]));
    expect(paid).toEqual({ CARD: '50', CASH: '56.2' });
  });

  it('rejects short payment, card change and overselling', async () => {
    const sale = (payments: object[], quantity = 1) => cashier.post('/pos/orders', { sessionId: session, lines: [{ productId: soap, quantity }], payments });
    expect((await sale([{ method: 'CASH', amount: 100 }]).expect(400)).body.message).toMatch(/don't cover/);
    expect((await sale([{ method: 'CARD', amount: 200 }]).expect(400)).body.message).toMatch(/Only cash/);
    expect((await sale([{ method: 'CASH', amount: 5000 }], 30).expect(400)).body.message).toMatch(/Only 17 in stock/);
    await B().post('/pos/orders', { sessionId: session, lines: [{ productId: soap, quantity: 1 }], payments: [{ method: 'CASH', amount: 118 }] }).expect(404);
  });

  it('refunds a whole sale back to the shelf and out of the drawer', async () => {
    await cashier.post(`/pos/orders/${firstSale}/refund`, { sessionId: session }).expect(403);
    const res = await A().post(`/pos/orders/${firstSale}/refund`, { sessionId: session }).expect(201);
    expect(res.body).toMatchObject({ number: 'POS-00003', total: '-295', refundOf: { id: firstSale } });
    expect(res.body.payments).toEqual([expect.objectContaining({ method: 'CASH', amount: '-295' })]);
    expect((await A().get(`/pos/orders/${firstSale}`)).body.status).toBe('REFUNDED');
    await A().post(`/pos/orders/${firstSale}/refund`, { sessionId: session }).expect(400);
    await A().post(`/pos/orders/${res.body.id}/refund`, { sessionId: session }).expect(400);
    expect(await onHand(soap)).toBe(19);
  });

  it('summarises the session and books the cash count difference at closing', async () => {
    const live = (await cashier.get(`/pos/sessions/${session}`).expect(200)).body;
    expect(live.expectedCash).toBe('1056.2');
    expect(live.totals).toMatchObject({ orders: 2, sales: '401.2', refunds: 1, refunded: '295' });
    const closed = (await cashier.post(`/pos/sessions/${session}/close`, { countedCash: 1050 }).expect(201)).body;
    expect(closed).toMatchObject({ status: 'CLOSED', expectedCash: '1056.2', countedCash: '1050', difference: '-6.2' });
    await cashier.post('/pos/orders', { sessionId: session, lines: [{ productId: soap, quantity: 1 }], payments: [{ method: 'CASH', amount: 118 }] }).expect(400);
    await cashier.post(`/pos/sessions/${session}/close`, { countedCash: 1050 }).expect(400);
  });

  it('posts sales, refunds, stock and the cash difference to the books', async () => {
    expect(await balances()).toMatchObject({
      '1000': '50', // 295 + 56.20 - 295 - 6.20 (the opening float was already in the drawer)
      '1010': '50', // card
      '1200': '1140', // 20 x 60 received, 3 sold, 2 returned
      '2100': '16.2',
      '4000': '90',
      '5000': '60',
      '6100': '6.2',
    });
  });

  it("only lets the opener or an admin close someone's session", async () => {
    const s = (await A().post('/pos/sessions', { registerId: register.id, openingCash: 0 }).expect(201)).body.id;
    await cashier.post(`/pos/sessions/${s}/close`, { countedCash: 0 }).expect(403);
    await A().post(`/pos/sessions/${s}/close`, { countedCash: 0 }).expect(201);
  });
});

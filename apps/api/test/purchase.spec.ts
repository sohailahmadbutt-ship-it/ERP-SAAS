import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const run = Date.now().toString(36);
const slugA = `pa-${run}`;
const slugB = `pb-${run}`;

describe('purchasing: RFQs, orders, receipts, bills, payments', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const as = (slug: string) => {
    const r = () => request(app.getHttpServer());
    const auth = (t: request.Test) => t.set('X-Tenant', slug).set('Authorization', `Bearer ${tokens[slug]}`);
    return {
      get: (url: string) => auth(r().get(url)),
      post: (url: string, body: object = {}) => auth(r().post(url)).send(body),
      patch: (url: string, body: object) => auth(r().patch(url)).send(body),
    };
  };

  let vendor: string;
  let rice: string;
  let freight: string;
  let gst: string;
  let wh: string;
  let poId: string;
  let billId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    for (const slug of [slugA, slugB]) {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ companyName: `Co ${slug}`, slug, name: 'Owner', email: `owner@${slug}.test`, password: 'password123' })
        .expect(201);
      tokens[slug] = res.body.token;
    }
    const A = as(slugA);
    vendor = (await A.post('/contacts', { name: 'Rice Mills Ltd' })).body.id;
    const kg = (await A.get('/units')).body.find((u: { code: string }) => u.code === 'kg').id;
    rice = (await A.post('/products', { name: 'Rice', sku: 'R', unitId: kg, salePrice: 300, cost: 200 })).body.id;
    freight = (await A.post('/products', { name: 'Freight', type: 'SERVICE', unitId: kg, cost: 1000 })).body.id;
    wh = (await A.get('/warehouses')).body[0].id;
    gst = (await A.get('/taxes')).body[0].id;
    // 10 kg already on hand at cost 200.
    await A.post('/stock/moves', { kind: 'RECEIPT', productId: rice, warehouseId: wh, quantity: 10 }).expect(201);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('creates an RFQ priced at product cost', async () => {
    const res = await as(slugA)
      .post('/purchase-orders', {
        vendorId: vendor,
        vendorRef: 'Q-77',
        lines: [
          { productId: rice, quantity: 30, unitPrice: 250, discountPct: 4, taxId: gst },
          { productId: freight, quantity: 1 },
        ],
      })
      .expect(201);
    poId = res.body.id;
    // 30 × 250 = 7500 − 4% = 7200, tax 1296; freight 1000 at cost, no tax
    expect(res.body).toMatchObject({ number: 'PO-00001', status: 'RFQ', subtotal: '8200', taxTotal: '1296', total: '9496' });
    expect(res.body.lines[1].unitPrice).toBe('1000');
  });

  it('confirms and marks the contact as a vendor', async () => {
    await as(slugA).post(`/purchase-orders/${poId}/confirm`).expect(201);
    await as(slugA).patch(`/purchase-orders/${poId}`, { notes: 'x' }).expect(400);
    expect((await as(slugA).get(`/contacts/${vendor}`)).body.isVendor).toBe(true);
  });

  it('receives in parts, adding stock and updating average cost', async () => {
    const po = (await as(slugA).get(`/purchase-orders/${poId}`)).body;
    const riceLine = po.lines.find((l: { productId: string }) => l.productId === rice);
    await as(slugA).post(`/purchase-orders/${poId}/receive`, { lines: [{ lineId: riceLine.id, quantity: 10 }] }).expect(201);
    // (10 × 200 + 10 × 240) / 20 = 220; unit cost is net of the 4% discount
    expect((await as(slugA).get(`/products/${rice}`)).body.cost).toBe('220');
    await as(slugA).post(`/purchase-orders/${poId}/receive`, { lines: [{ lineId: riceLine.id, quantity: 21 }] }).expect(400);
    const done = await as(slugA).post(`/purchase-orders/${poId}/receive`).expect(201);
    expect(done.body.lines.map((l: { receivedQty: string }) => l.receivedQty)).toEqual(['30', '1']);
    await as(slugA).post(`/purchase-orders/${poId}/receive`).expect(400);
    const product = (await as(slugA).get(`/products/${rice}`)).body;
    expect(product.stock[0].quantity).toBe('40');
    // (20 × 220 + 20 × 240) / 40 = 230
    expect(product.cost).toBe('230');
    const moves = (await as(slugA).get(`/stock/moves?productId=${rice}`)).body.items;
    expect(moves.filter((m: { reference: string }) => m.reference === 'PO-00001')).toHaveLength(2);
  });

  it('bills the order once, posts it and pays it off', async () => {
    const bill = await as(slugA).post(`/purchase-orders/${poId}/bill`).expect(201);
    billId = bill.body.id;
    expect(bill.body).toMatchObject({ status: 'DRAFT', number: null, vendorRef: 'Q-77', total: '9496' });
    await as(slugA).post(`/purchase-orders/${poId}/bill`).expect(400);
    await as(slugA).patch(`/bills/${billId}`, { vendorRef: 'INV-5521', dueDate: '2026-12-01' }).expect(200);
    const posted = await as(slugA).post(`/bills/${billId}/post`).expect(201);
    expect(posted.body).toMatchObject({ status: 'POSTED', number: 'BILL-00001', vendorRef: 'INV-5521' });
    await as(slugA).post(`/bills/${billId}/payments`, { amount: 10000, method: 'BANK' }).expect(400);
    await as(slugA).post(`/bills/${billId}/payments`, { amount: 4000, method: 'BANK' }).expect(201);
    await as(slugA).post(`/bills/${billId}/cancel`).expect(400);
    const paid = await as(slugA).post(`/bills/${billId}/payments`, { amount: 5496, method: 'CHEQUE', reference: 'CHQ 102' }).expect(201);
    expect(paid.body).toMatchObject({ status: 'PAID', amountPaid: '9496' });
    await as(slugA).post(`/purchase-orders/${poId}/cancel`).expect(400);
  });

  it('frees order lines when a bill is cancelled', async () => {
    const po = await as(slugA).post('/purchase-orders', { vendorId: vendor, lines: [{ productId: freight, quantity: 2 }] });
    await as(slugA).post(`/purchase-orders/${po.body.id}/confirm`).expect(201);
    const bill = await as(slugA).post(`/purchase-orders/${po.body.id}/bill`).expect(201);
    await as(slugA).post(`/bills/${bill.body.id}/cancel`).expect(201);
    expect((await as(slugA).post(`/purchase-orders/${po.body.id}/bill`).expect(201)).body.total).toBe('2000');
  });

  it('records a standalone bill', async () => {
    const bill = await as(slugA).post('/bills', { vendorId: vendor, vendorRef: 'RENT-11', lines: [{ productId: freight, quantity: 1, unitPrice: 50000 }] }).expect(201);
    expect(bill.body.total).toBe('50000');
    expect((await as(slugA).post(`/bills/${bill.body.id}/post`).expect(201)).body.number).toBe('BILL-00002');
    const search = (await as(slugA).get('/bills?q=RENT')).body;
    expect(search.items).toHaveLength(1);
  });

  it('keeps purchasing separate between companies', async () => {
    const B = as(slugB);
    expect((await B.get('/purchase-orders')).body.total).toBe(0);
    expect((await B.get('/bills')).body.total).toBe(0);
    await B.get(`/purchase-orders/${poId}`).expect(404);
    await B.post(`/purchase-orders/${poId}/receive`).expect(404);
    await B.post(`/bills/${billId}/cancel`).expect(404);
    await B.post('/purchase-orders', { vendorId: vendor, lines: [] }).expect(400);
  });
});

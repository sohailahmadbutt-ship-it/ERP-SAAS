import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { lineAmounts } from '../src/sales/money';

const run = Date.now().toString(36);
const slugA = `sa-${run}`;
const slugB = `sb-${run}`;

describe('line amounts', () => {
  it('applies discount before tax and rounds half up', () => {
    const a = lineAmounts(3, '33.335', 10, 18);
    // 3 × 33.335 = 100.005 → less 10% = 90.0045 → 90.00; tax 16.20
    expect([a.subtotal.toString(), a.taxAmount.toString(), a.total.toString()]).toEqual(['90', '16.2', '106.2']);
    expect(lineAmounts(1, '0.05', 0, 18).taxAmount.toString()).toBe('0.01');
  });
});

describe('sales: quotations, orders, delivery, invoices, payments', () => {
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

  let customer: string;
  let widget: string;
  let install: string;
  let gst: string;
  let wh: string;
  let orderId: string;
  let invoiceId: string;

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
    customer = (await A.post('/contacts', { name: 'Acme Traders' })).body.id;
    const pcs = (await A.get('/units')).body.find((u: { code: string }) => u.code === 'pcs').id;
    widget = (await A.post('/products', { name: 'Widget', sku: 'W', unitId: pcs, salePrice: 100 })).body.id;
    install = (await A.post('/products', { name: 'Installation', type: 'SERVICE', unitId: pcs, salePrice: 500 })).body.id;
    wh = (await A.get('/warehouses')).body[0].id;
    gst = (await A.get('/taxes')).body[0].id;
    await A.post('/stock/moves', { kind: 'RECEIPT', productId: widget, warehouseId: wh, quantity: 10 }).expect(201);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('gives a new company a GST 18% tax', async () => {
    const taxes = (await as(slugA).get('/taxes').expect(200)).body;
    expect(taxes.map((t: { name: string; rate: string }) => `${t.name}=${t.rate}`)).toEqual(['GST 18%=18']);
  });

  it('creates a numbered quotation with computed totals', async () => {
    const res = await as(slugA)
      .post('/sales-orders', {
        customerId: customer,
        lines: [
          { productId: widget, quantity: 4, discountPct: 10, taxId: gst },
          { productId: install, quantity: 1, taxId: gst },
        ],
      })
      .expect(201);
    orderId = res.body.id;
    expect(res.body).toMatchObject({ status: 'QUOTATION', number: 'SO-00001', currency: 'PKR', subtotal: '860', taxTotal: '154.8', total: '1014.8' });
    expect(res.body.lines.map((l: { description: string; unitPrice: string }) => `${l.description}@${l.unitPrice}`)).toEqual(['Widget@100', 'Installation@500']);
    const second = await as(slugA).post('/sales-orders', { customerId: customer, lines: [] }).expect(201);
    expect(second.body.number).toBe('SO-00002');
  });

  it('edits a quotation, then locks it once confirmed', async () => {
    const res = await as(slugA)
      .patch(`/sales-orders/${orderId}`, {
        lines: [
          { productId: widget, quantity: 5, taxId: gst },
          { productId: install, quantity: 1, unitPrice: 400 },
        ],
      })
      .expect(200);
    // 500 + 400 = 900; tax 18% on 500 only = 90
    expect(res.body).toMatchObject({ subtotal: '900', taxTotal: '90', total: '990' });
    const confirmed = await as(slugA).post(`/sales-orders/${orderId}/confirm`).expect(201);
    expect(confirmed.body.status).toBe('CONFIRMED');
    await as(slugA).patch(`/sales-orders/${orderId}`, { notes: 'x' }).expect(400);
    const contact = await as(slugA).get(`/contacts/${customer}`);
    expect(contact.body.isCustomer).toBe(true);
  });

  it('refuses to confirm an empty quotation', async () => {
    const empty = (await as(slugA).get('/sales-orders?q=SO-00002')).body.items[0];
    await as(slugA).post(`/sales-orders/${empty.id}/confirm`).expect(400);
  });

  it('delivers partially, then the rest, taking goods out of stock', async () => {
    const order = (await as(slugA).get(`/sales-orders/${orderId}`)).body;
    const widgetLine = order.lines.find((l: { productId: string }) => l.productId === widget);
    await as(slugA).post(`/sales-orders/${orderId}/deliver`, { lines: [{ lineId: widgetLine.id, quantity: 2 }] }).expect(201);
    await as(slugA).post(`/sales-orders/${orderId}/deliver`, { lines: [{ lineId: widgetLine.id, quantity: 4 }] }).expect(400);
    const done = await as(slugA).post(`/sales-orders/${orderId}/deliver`).expect(201);
    expect(done.body.lines.map((l: { deliveredQty: string }) => l.deliveredQty)).toEqual(['5', '1']);
    await as(slugA).post(`/sales-orders/${orderId}/deliver`).expect(400);
    const product = (await as(slugA).get(`/products/${widget}`)).body;
    expect(product.stock[0].quantity).toBe('5');
    const moves = (await as(slugA).get(`/stock/moves?productId=${widget}`)).body.items;
    expect(moves.filter((m: { reference: string }) => m.reference === 'SO-00001')).toHaveLength(2);
  });

  it('will not deliver more than is in stock', async () => {
    const big = await as(slugA).post('/sales-orders', { customerId: customer, lines: [{ productId: widget, quantity: 50 }] });
    await as(slugA).post(`/sales-orders/${big.body.id}/confirm`).expect(201);
    const res = await as(slugA).post(`/sales-orders/${big.body.id}/deliver`).expect(400);
    expect(res.body.message).toMatch(/Only 5 in stock/);
    await as(slugA).post(`/sales-orders/${big.body.id}/cancel`).expect(201);
  });

  it('invoices the order once, posts it with a number, and takes payments', async () => {
    const inv = await as(slugA).post(`/sales-orders/${orderId}/invoice`).expect(201);
    invoiceId = inv.body.id;
    expect(inv.body).toMatchObject({ status: 'DRAFT', number: null, total: '990' });
    await as(slugA).post(`/sales-orders/${orderId}/invoice`).expect(400);
    await as(slugA).post(`/invoices/${invoiceId}/payments`, { amount: 10, method: 'CASH' }).expect(400);

    const posted = await as(slugA).post(`/invoices/${invoiceId}/post`).expect(201);
    expect(posted.body).toMatchObject({ status: 'POSTED', number: 'INV-00001' });
    await as(slugA).post(`/invoices/${invoiceId}/post`).expect(400);

    await as(slugA).post(`/invoices/${invoiceId}/payments`, { amount: 1000, method: 'CASH' }).expect(400);
    const part = await as(slugA).post(`/invoices/${invoiceId}/payments`, { amount: 490, method: 'BANK', reference: 'TXN-1' }).expect(201);
    expect(part.body).toMatchObject({ status: 'POSTED', amountPaid: '490' });
    await as(slugA).post(`/invoices/${invoiceId}/cancel`).expect(400);
    const full = await as(slugA).post(`/invoices/${invoiceId}/payments`, { amount: 500, method: 'CASH' }).expect(201);
    expect(full.body).toMatchObject({ status: 'PAID', amountPaid: '990' });
    expect(full.body.payments).toHaveLength(2);
    await as(slugA).post(`/sales-orders/${orderId}/cancel`).expect(400);
  });

  it('frees order lines when an invoice is cancelled', async () => {
    const o = await as(slugA).post('/sales-orders', { customerId: customer, lines: [{ productId: install, quantity: 2 }] });
    await as(slugA).post(`/sales-orders/${o.body.id}/confirm`).expect(201);
    const inv = await as(slugA).post(`/sales-orders/${o.body.id}/invoice`).expect(201);
    await as(slugA).post(`/invoices/${inv.body.id}/cancel`).expect(201);
    const again = await as(slugA).post(`/sales-orders/${o.body.id}/invoice`).expect(201);
    expect(again.body.total).toBe('1000');
  });

  it('creates and edits a standalone invoice', async () => {
    const inv = await as(slugA).post('/invoices', { customerId: customer, lines: [{ productId: install, quantity: 1 }] }).expect(201);
    const edited = await as(slugA).patch(`/invoices/${inv.body.id}`, { lines: [{ productId: install, quantity: 2, taxId: gst }] }).expect(200);
    expect(edited.body).toMatchObject({ subtotal: '1000', taxTotal: '180', total: '1180' });
    const posted = await as(slugA).post(`/invoices/${inv.body.id}/post`).expect(201);
    expect(posted.body.number).toBe('INV-00002');
    const list = (await as(slugA).get('/invoices?status=POSTED')).body;
    expect(list.items.map((i: { number: string }) => i.number)).toEqual(['INV-00002']);
    await as(slugA).get('/invoices?status=NOPE').expect(400);
  });

  it('keeps sales separate between companies', async () => {
    const B = as(slugB);
    expect((await B.get('/sales-orders')).body.total).toBe(0);
    expect((await B.get('/invoices')).body.total).toBe(0);
    await B.get(`/sales-orders/${orderId}`).expect(404);
    await B.post(`/sales-orders/${orderId}/confirm`).expect(404);
    await B.post(`/invoices/${invoiceId}/payments`, { amount: 1, method: 'CASH' }).expect(404);
    // B's own numbering starts at 1, and it can't use A's customer, product or tax.
    const bCustomer = (await B.post('/contacts', { name: 'B customer' })).body.id;
    await B.post('/sales-orders', { customerId: customer, lines: [] }).expect(400);
    await B.post('/sales-orders', { customerId: bCustomer, lines: [{ productId: widget, quantity: 1 }] }).expect(400);
    const bOrder = await B.post('/sales-orders', { customerId: bCustomer, lines: [] }).expect(201);
    expect(bOrder.body.number).toBe('SO-00001');
  });
});

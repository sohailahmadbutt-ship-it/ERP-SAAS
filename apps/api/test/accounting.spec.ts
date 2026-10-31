import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const run = Date.now().toString(36);
const slugA = `aa-${run}`;
const slugB = `ab-${run}`;

describe('accounting: automatic journal and reports', () => {
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
  const A = () => as(slugA);
  let acc: Record<string, string>;
  const balances = async () => {
    const list = (await A().get('/accounts').expect(200)).body as { code: string; balance: string }[];
    return Object.fromEntries(list.filter((a) => a.balance !== '0').map((a) => [a.code, a.balance]));
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
        .send({ companyName: `Co ${slug}`, slug, name: 'Owner', email: `owner@${slug}.test`, password: 'password123' })
        .expect(201);
      tokens[slug] = res.body.token;
    }
    acc = Object.fromEntries((await A().get('/accounts')).body.map((a: { code: string; id: string }) => [a.code, a.id]));
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('gives a new company a starter chart of accounts', () => {
    expect(Object.keys(acc)).toEqual(['1000', '1010', '1100', '1200', '1300', '2000', '2100', '2200', '3000', '4000', '5000', '5100', '6000']);
  });

  it('posts a manual entry and rejects unbalanced ones', async () => {
    // Owner puts 100,000 into the bank.
    const e = await A()
      .post('/journal-entries', { date: '2026-01-02', memo: 'Opening capital', lines: [{ accountId: acc['1010'], debit: 100000 }, { accountId: acc['3000'], credit: 100000 }] })
      .expect(201);
    expect(e.body.number).toBe('JE-00001');
    await A().post('/journal-entries', { date: '2026-01-02', lines: [{ accountId: acc['1010'], debit: 10 }, { accountId: acc['3000'], credit: 9 }] }).expect(400);
    await A().post('/journal-entries', { date: '2026-01-02', lines: [{ accountId: acc['1010'], debit: 10, credit: 10 }, { accountId: acc['3000'], credit: 0 }] }).expect(400);
  });

  it('refuses an unbalanced entry at the database level too', async () => {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: slugA } });
    await expect(
      prisma.withTenant(tenant.id, (tx) =>
        tx.journalEntry.create({
          data: {
            tenantId: tenant.id, number: 'X-1', date: new Date(), source: 'MANUAL', createdById: tenant.id,
            lines: { createMany: { data: [{ accountId: acc['1010'], debit: 5, date: new Date() }] } },
          },
        }),
      ),
    ).rejects.toThrow(/does not balance/);
  });

  it('posts purchasing, stock and sales automatically and the books balance', async () => {
    const vendor = (await A().post('/contacts', { name: 'Mill' })).body.id;
    const customer = (await A().post('/contacts', { name: 'Shop' })).body.id;
    const pcs = (await A().get('/units')).body.find((u: { code: string }) => u.code === 'pcs').id;
    const item = (await A().post('/products', { name: 'Item', unitId: pcs, salePrice: 150 })).body.id;
    const gst = (await A().get('/taxes')).body[0].id;

    // Buy 10 @ 100 + 18% tax, receive, bill, pay by bank.
    const po = (await A().post('/purchase-orders', { vendorId: vendor, lines: [{ productId: item, quantity: 10, unitPrice: 100, taxId: gst }] })).body;
    await A().post(`/purchase-orders/${po.id}/confirm`).expect(201);
    await A().post(`/purchase-orders/${po.id}/receive`).expect(201);
    expect(await balances()).toMatchObject({ '1200': '1000', '2200': '1000' });
    const bill = (await A().post(`/purchase-orders/${po.id}/bill`)).body;
    await A().post(`/bills/${bill.id}/post`).expect(201);
    await A().post(`/bills/${bill.id}/payments`, { amount: 1180, method: 'BANK' }).expect(201);

    // Sell 4 @ 150 + 18%, deliver, invoice, customer pays 300 cash.
    const so = (await A().post('/sales-orders', { customerId: customer, lines: [{ productId: item, quantity: 4, taxId: gst }] })).body;
    await A().post(`/sales-orders/${so.id}/confirm`).expect(201);
    await A().post(`/sales-orders/${so.id}/deliver`).expect(201);
    const inv = (await A().post(`/sales-orders/${so.id}/invoice`)).body;
    await A().post(`/invoices/${inv.id}/post`).expect(201);
    await A().post(`/invoices/${inv.id}/payments`, { amount: 300, method: 'CASH' }).expect(201);

    expect(await balances()).toEqual({
      '1000': '300', // cash from customer
      '1010': '98820', // 100,000 − 1,180
      '1100': '408', // 708 invoiced − 300 paid
      '1200': '600', // 1,000 in − 400 sold at cost
      '1300': '180', // input tax
      '2100': '108', // output tax
      '3000': '100000',
      '4000': '600',
      '5000': '400',
    });

    const tb = (await A().get('/reports/trial-balance').expect(200)).body;
    expect(tb.totals.debit).toBe(tb.totals.credit);

    const pl = (await A().get('/reports/profit-loss?from=2026-01-01').expect(200)).body;
    expect(pl).toMatchObject({ income: { total: '600' }, expenses: { total: '400' }, netProfit: '200' });

    const bs = (await A().get('/reports/balance-sheet').expect(200)).body;
    expect(bs.assets.total).toBe('100308');
    expect(bs.equity.currentEarnings).toBe('200');
    expect(bs.liabilitiesAndEquity).toBe(bs.assets.total);
  });

  it('reverses an invoice entry when the invoice is cancelled', async () => {
    const customer = (await A().post('/contacts', { name: 'Walk-in' })).body.id;
    const svc = (await A().post('/products', { name: 'Consulting', type: 'SERVICE', unitId: (await A().get('/units')).body[0].id, salePrice: 1000 })).body.id;
    const before = await balances();
    const inv = (await A().post('/invoices', { customerId: customer, lines: [{ productId: svc, quantity: 1 }] })).body;
    await A().post(`/invoices/${inv.id}/post`).expect(201);
    expect((await balances())['4000']).toBe(String(Number(before['4000']) + 1000));
    await A().post(`/invoices/${inv.id}/cancel`).expect(201);
    expect(await balances()).toEqual(before);
    const entries = (await A().get(`/journal-entries?q=${encodeURIComponent((await A().get(`/invoices/${inv.id}`)).body.number)}`)).body;
    expect(entries.total).toBe(2);
  });

  it('values stock counts and manual receipts through stock adjustments', async () => {
    const pcs = (await A().get('/units')).body.find((u: { code: string }) => u.code === 'pcs').id;
    const p = (await A().post('/products', { name: 'Box', unitId: pcs, cost: 20 })).body.id;
    const wh = (await A().get('/warehouses')).body[0].id;
    const before = await balances();
    await A().post('/stock/moves', { kind: 'RECEIPT', productId: p, warehouseId: wh, quantity: 5 }).expect(201);
    await A().post('/stock/moves', { kind: 'COUNT', productId: p, warehouseId: wh, countedQuantity: 3 }).expect(201);
    const after = await balances();
    // +5 × 20 then −2 × 20: inventory +60, adjustments account nets −60 (a gain)
    expect(Number(after['1200']) - Number(before['1200'])).toBe(60);
    expect(Number(after['5100'] ?? 0) - Number(before['5100'] ?? 0)).toBe(-60);
  });

  it('shows an account ledger with running balance', async () => {
    const l = (await A().get(`/reports/ledger?accountId=${acc['1010']}`).expect(200)).body;
    expect(l.lines.map((x: { balance: string }) => x.balance)).toEqual(['100000', '98820']);
    expect(l.closingBalance).toBe('98820');
  });

  it('protects system accounts and lets admins add their own', async () => {
    await A().patch(`/accounts/${acc['1100']}`, { archived: true }).expect(400);
    await A().post('/accounts', { code: '6100', name: 'Rent', type: 'EXPENSE' }).expect(201);
    await A().post('/accounts', { code: '6100', name: 'Dup', type: 'EXPENSE' }).expect(409);
  });

  it('keeps the books separate between companies', async () => {
    const B = as(slugB);
    expect((await B.get('/journal-entries')).body.total).toBe(0);
    const tb = (await B.get('/reports/trial-balance')).body;
    expect(tb.rows).toEqual([]);
    await B.get(`/reports/ledger?accountId=${acc['1010']}`).expect(404);
    const bAcc = (await B.get('/accounts')).body;
    await B.post('/journal-entries', { date: '2026-01-02', lines: [{ accountId: acc['1010'], debit: 1 }, { accountId: bAcc[0].id, credit: 1 }] }).expect(400);
  });
});

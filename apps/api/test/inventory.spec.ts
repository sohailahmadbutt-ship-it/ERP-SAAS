import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const run = Date.now().toString(36);
const slugA = `ia-${run}`;
const slugB = `ib-${run}`;

describe('inventory: products, warehouses and stock', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const as = (slug: string) => {
    const r = () => request(app.getHttpServer());
    const auth = (t: request.Test) => t.set('X-Tenant', slug).set('Authorization', `Bearer ${tokens[slug]}`);
    return {
      get: (url: string) => auth(r().get(url)),
      post: (url: string, body: object) => auth(r().post(url)).send(body),
      patch: (url: string, body: object) => auth(r().patch(url)).send(body),
      delete: (url: string) => auth(r().delete(url)),
    };
  };

  let pcs: string;
  let main: string;
  let shop: string;
  let widget: string;

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
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('gives a new company default units and a main warehouse', async () => {
    const units = await as(slugA).get('/units').expect(200);
    pcs = units.body.find((u: { code: string }) => u.code === 'pcs').id;
    const whs = await as(slugA).get('/warehouses').expect(200);
    expect(whs.body.map((w: { code: string }) => w.code)).toEqual(['WH']);
    main = whs.body[0].id;
    shop = (await as(slugA).post('/warehouses', { code: 'shop', name: 'Shop floor' }).expect(201)).body.id;
    await as(slugA).post('/warehouses', { code: 'SHOP', name: 'Dup' }).expect(409);
  });

  it('creates products with unique SKUs', async () => {
    const res = await as(slugA).post('/products', { name: 'Widget', sku: 'W-1', unitId: pcs, salePrice: 250, cost: 120.5 }).expect(201);
    widget = res.body.id;
    expect(res.body.salePrice).toBe('250');
    await as(slugA).post('/products', { name: 'Widget copy', sku: 'W-1', unitId: pcs }).expect(409);
    await as(slugA).post('/products', { name: 'Install', type: 'SERVICE', unitId: pcs }).expect(201);
    const search = await as(slugA).get('/products?q=w-1').expect(200);
    expect(search.body.items.map((p: { name: string }) => p.name)).toEqual(['Widget']);
  });

  it("refuses another company's unit, even by id", async () => {
    // Composite (id, tenant_id) foreign keys make the database reject this.
    await as(slugB).post('/products', { name: 'Stolen unit', unitId: pcs }).expect(400);
  });

  it('receives, delivers, transfers and counts stock', async () => {
    await as(slugA).post('/stock/moves', { kind: 'RECEIPT', productId: widget, warehouseId: main, quantity: 10, unitCost: 120 }).expect(201);
    await as(slugA).post('/stock/moves', { kind: 'DELIVERY', productId: widget, warehouseId: main, quantity: 3, reference: 'SO-1' }).expect(201);
    const t = await as(slugA).post('/stock/moves', { kind: 'TRANSFER', productId: widget, warehouseId: main, toWarehouseId: shop, quantity: 2 }).expect(201);
    expect(t.body.map((m: { type: string }) => m.type)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN']);
    // Counted 4 on the shop floor, so +2 is recorded.
    const c = await as(slugA).post('/stock/moves', { kind: 'COUNT', productId: widget, warehouseId: shop, countedQuantity: 4 }).expect(201);
    expect(c.body[0]).toMatchObject({ type: 'ADJUSTMENT', quantity: '2' });

    const detail = await as(slugA).get(`/products/${widget}`).expect(200);
    const qty = Object.fromEntries(detail.body.stock.map((s: { warehouse: { code: string }; quantity: string }) => [s.warehouse.code, s.quantity]));
    expect(qty).toEqual({ WH: '5', SHOP: '4' });

    const list = await as(slugA).get('/products?q=widget').expect(200);
    expect(list.body.items[0].onHand).toBe('9');

    const levels = await as(slugA).get('/stock/levels').expect(200);
    expect(levels.body.map((l: { warehouse: { code: string }; quantity: string }) => `${l.warehouse.code}=${l.quantity}`)).toEqual(['SHOP=4', 'WH=5']);

    const moves = await as(slugA).get(`/stock/moves?productId=${widget}`).expect(200);
    expect(moves.body.total).toBe(5);
  });

  it('blocks taking out more than is in stock', async () => {
    const res = await as(slugA).post('/stock/moves', { kind: 'DELIVERY', productId: widget, warehouseId: main, quantity: 6 }).expect(400);
    expect(res.body.message).toMatch(/Only 5 in stock/);
    await as(slugA).post('/stock/moves', { kind: 'TRANSFER', productId: widget, warehouseId: shop, toWarehouseId: shop, quantity: 1 }).expect(400);
  });

  it('does not oversell when deliveries arrive at the same time', async () => {
    // 5 in WH; ten parallel deliveries of 1 must leave exactly 0, never negative.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => as(slugA).post('/stock/moves', { kind: 'DELIVERY', productId: widget, warehouseId: main, quantity: 1 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    const detail = await as(slugA).get(`/products/${widget}`).expect(200);
    expect(detail.body.stock.find((s: { warehouse: { code: string } }) => s.warehouse.code === 'WH').quantity).toBe('0');
  });

  it('rejects stock moves for services and validates input', async () => {
    const svc = (await as(slugA).get('/products?type=SERVICE')).body.items[0].id;
    await as(slugA).post('/stock/moves', { kind: 'RECEIPT', productId: svc, warehouseId: main, quantity: 1 }).expect(400);
    await as(slugA).post('/stock/moves', { kind: 'RECEIPT', productId: widget, warehouseId: main, quantity: -1 }).expect(400);
    await as(slugA).post('/stock/moves', { kind: 'TRANSFER', productId: widget, warehouseId: main, quantity: 1 }).expect(400);
  });

  it('stops a product with stock history from changing type', async () => {
    await as(slugA).patch(`/products/${widget}`, { type: 'SERVICE' }).expect(400);
    await as(slugA).patch(`/products/${widget}`, { salePrice: 260 }).expect(200);
  });

  it('keeps inventory separate between companies', async () => {
    expect((await as(slugB).get('/products')).body.total).toBe(0);
    expect((await as(slugB).get('/stock/levels')).body).toEqual([]);
    await as(slugB).get(`/products/${widget}`).expect(404);
    await as(slugB).patch(`/warehouses/${main}`, { name: 'x' }).expect(404);
    const bMain = (await as(slugB).get('/warehouses')).body[0].id;
    // B's warehouse with A's product, and A's warehouse with nothing of B's.
    await as(slugB).post('/stock/moves', { kind: 'RECEIPT', productId: widget, warehouseId: bMain, quantity: 1 }).expect(400);
  });
});

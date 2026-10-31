import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const run = Date.now().toString(36);
const slugA = `ca-${run}`;
const slugB = `cb-${run}`;

describe('company settings and contacts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const as = (slug: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('X-Tenant', slug).set('Authorization', `Bearer ${tokens[slug]}`),
    post: (url: string, body: object) => request(app.getHttpServer()).post(url).set('X-Tenant', slug).set('Authorization', `Bearer ${tokens[slug]}`).send(body),
    patch: (url: string, body: object) => request(app.getHttpServer()).patch(url).set('X-Tenant', slug).set('Authorization', `Bearer ${tokens[slug]}`).send(body),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('X-Tenant', slug).set('Authorization', `Bearer ${tokens[slug]}`),
  });

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

  it('updates company settings', async () => {
    const res = await as(slugA).patch('/company', { taxId: '1234567-8', currency: 'usd', city: 'Lahore', country: 'pk' }).expect(200);
    expect(res.body).toMatchObject({ taxId: '1234567-8', currency: 'USD', city: 'Lahore', country: 'PK' });
    await as(slugA).patch('/company', { currency: 'DOLLARS' }).expect(400);
  });

  it('only lets owners and admins change company settings', async () => {
    await as(slugA).post('/users', { name: 'M', email: 'm@a.test', password: 'password123' }).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/login').set('X-Tenant', slugA).send({ email: 'm@a.test', password: 'password123' });
    await request(app.getHttpServer()).patch('/company').set('X-Tenant', slugA).set('Authorization', `Bearer ${login.body.token}`).send({ city: 'X' }).expect(403);
  });

  let acmeId: string;

  it('creates, searches and filters contacts', async () => {
    const acme = await as(slugA).post('/contacts', { name: 'Acme Traders', isCustomer: true, taxId: 'NTN-99', creditLimit: 50000.5 }).expect(201);
    acmeId = acme.body.id;
    expect(acme.body.creditLimit).toBe('50000.5');
    await as(slugA).post('/contacts', { name: 'Bolt Supplies', isVendor: true, email: 'Sales@Bolt.test' }).expect(201);
    await as(slugA).post('/contacts', { name: 'Ali Khan', kind: 'PERSON', parentId: acmeId, phone: '0300-1234567' }).expect(201);

    const all = await as(slugA).get('/contacts').expect(200);
    expect(all.body.total).toBe(3);
    const vendors = await as(slugA).get('/contacts?role=vendor').expect(200);
    expect(vendors.body.items.map((c: { name: string }) => c.name)).toEqual(['Bolt Supplies']);
    const search = await as(slugA).get('/contacts?q=bolt.test').expect(200);
    expect(search.body.items[0].email).toBe('sales@bolt.test');

    const detail = await as(slugA).get(`/contacts/${acmeId}`).expect(200);
    expect(detail.body.children.map((c: { name: string }) => c.name)).toEqual(['Ali Khan']);
  });

  it('enforces company and person rules', async () => {
    await as(slugA).post('/contacts', { name: 'Sub Co', parentId: acmeId }).expect(400);
    await as(slugA).patch(`/contacts/${acmeId}`, { kind: 'PERSON' }).expect(400);
    await as(slugA).post('/contacts', { name: 'Bad', creditLimit: -1 }).expect(400);
  });

  it('keeps contacts separate between companies', async () => {
    const b = await as(slugB).get('/contacts').expect(200);
    expect(b.body.total).toBe(0);
    await as(slugB).get(`/contacts/${acmeId}`).expect(404);
    await as(slugB).patch(`/contacts/${acmeId}`, { name: 'Hacked' }).expect(404);
    await as(slugB).delete(`/contacts/${acmeId}`).expect(404);
  });

  it("rejects linking to another company's contact", async () => {
    // Postgres checks foreign keys without row-level security, so the API must check this itself.
    await as(slugB).post('/contacts', { name: 'Spy', kind: 'PERSON', parentId: acmeId }).expect(400);
  });

  it('archives instead of deleting', async () => {
    const bolt = (await as(slugA).get('/contacts?role=vendor')).body.items[0];
    await as(slugA).delete(`/contacts/${bolt.id}`).expect(200);
    expect((await as(slugA).get('/contacts')).body.total).toBe(2);
    expect((await as(slugA).get('/contacts?archived=true')).body.items[0].name).toBe('Bolt Supplies');
    await as(slugA).patch(`/contacts/${bolt.id}`, { archived: false }).expect(200);
    expect((await as(slugA).get('/contacts')).body.total).toBe(3);
  });
});

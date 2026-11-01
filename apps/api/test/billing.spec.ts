import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { addMonths } from '../src/billing/subscription';

const run = Date.now().toString(36);
const slugA = `bill-a-${run}`;
const slugB = `bill-b-${run}`;
const adminEmail = `admin-${run}@platform.test`;
const planCode = `test-${run}`;
const DAY = 86400000;

describe('subscriptions, billing and the platform console', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;
  let admin: string;
  let invoiceId: string;

  const http = () => request(app.getHttpServer());
  const as = (slug: string, token: string) => ({
    get: (url: string) => http().get(url).set('X-Tenant', slug).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => http().post(url).set('X-Tenant', slug).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => http().patch(url).set('X-Tenant', slug).set('Authorization', `Bearer ${token}`).send(body),
  });
  const A = () => as(slugA, tokenA);
  const B = () => as(slugB, tokenB);
  const P = {
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${admin}`),
    post: (url: string, body: object = {}) => http().post(url).set('Authorization', `Bearer ${admin}`).send(body),
    patch: (url: string, body: object = {}) => http().patch(url).set('Authorization', `Bearer ${admin}`).send(body),
  };
  const setTenant = (data: object) => prisma.tenant.update({ where: { id: tenantA }, data });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.platformAdmin.create({ data: { email: adminEmail, name: 'Ops', passwordHash: await bcrypt.hash('platform-password', 10) } });
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
    await prisma.plan.deleteMany({ where: { code: planCode } });
    await app.close();
  });

  it('starts every new company on a 14-day trial', async () => {
    const a = await http().post('/auth/signup').send({ companyName: 'Bill A', slug: slugA, name: 'Owner', email: 'o@a.test', password: 'password123', plan: 'starter' }).expect(201);
    const b = await http().post('/auth/signup').send({ companyName: 'Bill B', slug: slugB, name: 'Owner', email: 'o@b.test', password: 'password123' }).expect(201);
    tokenA = a.body.token;
    tokenB = b.body.token;
    tenantA = a.body.tenant.id;
    await http().post('/auth/signup').send({ companyName: 'X', slug: `x-${run}`, name: 'O', email: 'o@x.test', password: 'password123', plan: 'nope' }).expect(400);

    const res = await A().get('/billing').expect(200);
    expect(res.body).toMatchObject({ status: 'TRIALING', state: 'trial', access: 'full', daysLeft: 14, userCount: 1 });
    expect(res.body.plan.code).toBe('starter');
    expect(res.body.plans.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['starter', 'business', 'enterprise']));
    expect((await B().get('/billing')).body.plan.code).toBe('business');
    expect((await A().get('/auth/me')).body.subscription).toMatchObject({ state: 'trial', daysLeft: 14 });
    const prices = (await http().get('/plans').expect(200)).body;
    expect(prices.find((p: { code: string }) => p.code === 'starter')).toMatchObject({ priceMonthly: '4999', maxUsers: 3 });
  });

  it("enforces the plan's user limit", async () => {
    await A().post('/users', { name: 'U2', email: 'u2@a.test', password: 'password123' }).expect(201);
    await A().post('/users', { name: 'U3', email: 'u3@a.test', password: 'password123' }).expect(201);
    const res = await A().post('/users', { name: 'U4', email: 'u4@a.test', password: 'password123' }).expect(403);
    expect(res.body.message).toMatch(/Starter plan allows 3 users/);
  });

  it('switches plans freely during the trial, within the user count', async () => {
    await A().patch('/billing/plan', { planCode: 'business' }).expect(200);
    await A().post('/users', { name: 'U4', email: 'u4@a.test', password: 'password123' }).expect(201);
    const res = await A().patch('/billing/plan', { planCode: 'starter' }).expect(400);
    expect(res.body.message).toMatch(/allows 3 users and you have 4/);
    // Only the owner can change the plan.
    const member = await http().post('/auth/login').set('X-Tenant', slugA).send({ email: 'u2@a.test', password: 'password123' });
    await as(slugA, member.body.token).patch('/billing/plan', { planCode: 'enterprise' }).expect(403);
  });

  it('makes the company read-only once the trial ends, except for billing', async () => {
    await setTenant({ trialEndsAt: new Date(Date.now() - DAY) });
    const res = await A().post('/contacts', { name: 'Blocked' }).expect(402);
    expect(res.body).toMatchObject({ state: 'trial_expired' });
    expect(res.body.message).toMatch(/trial has ended/);
    await A().get('/contacts').expect(200);
    expect((await A().get('/billing')).body).toMatchObject({ state: 'trial_expired', access: 'read_only' });
    // Other companies are unaffected.
    await B().post('/contacts', { name: 'Fine' }).expect(201);
  });

  it('issues one open invoice at checkout', async () => {
    const first = await A().post('/billing/checkout', { planCode: 'business' }).expect(201);
    const second = await A().post('/billing/checkout', { planCode: 'enterprise' }).expect(201);
    expect(second.body).toMatchObject({ status: 'OPEN', planCode: 'enterprise', amount: '39999', currency: 'PKR' });
    expect(second.body.number).toMatch(/^PINV-\d{5}$/);
    const start = new Date(second.body.periodStart);
    expect(Math.abs(start.getTime() - Date.now())).toBeLessThan(60000);
    expect(new Date(second.body.periodEnd).toISOString()).toBe(addMonths(start, 1).toISOString());
    const { invoices } = (await A().get('/billing')).body;
    expect(invoices.find((i: { id: string }) => i.id === first.body.id).status).toBe('VOID');
    await A().post('/billing/checkout', { planCode: 'starter' }).expect(400); // 4 users > 3
    invoiceId = second.body.id;
  });

  it('lets the company report a payment reference, and keeps invoices private', async () => {
    const res = await A().post(`/billing/invoices/${invoiceId}/payment`, { reference: 'HBL-TRX-5521' }).expect(201);
    expect(res.body.paymentReference).toBe('HBL-TRX-5521');
    await B().post(`/billing/invoices/${invoiceId}/payment`, { reference: 'stolen' }).expect(404);
    expect((await B().get('/billing')).body.invoices).toHaveLength(0);
  });

  it('keeps company and platform tokens apart', async () => {
    await http().post('/platform/login').send({ email: adminEmail, password: 'wrong' }).expect(401);
    const login = await http().post('/platform/login').send({ email: adminEmail, password: 'platform-password' }).expect(201);
    admin = login.body.token;
    await http().get('/platform/tenants').set('Authorization', `Bearer ${tokenA}`).expect(401);
    await http().get('/platform/tenants').expect(401);
    await as(slugA, admin).get('/contacts').expect(401);
    expect((await P.get('/platform/me').expect(200)).body.email).toBe(adminEmail);
  });

  it('lists companies with their subscription state and user counts', async () => {
    const list = (await P.get(`/platform/tenants?q=${run}`).expect(200)).body;
    const a = list.find((t: { slug: string }) => t.slug === slugA);
    expect(a).toMatchObject({ userCount: 4, state: 'trial_expired', plan: 'business' });
    const detail = (await P.get(`/platform/tenants/${tenantA}`).expect(200)).body;
    expect(detail.users).toHaveLength(4);
    expect(detail.users[0].passwordHash).toBeUndefined();
    expect(detail.platformInvoices).toHaveLength(2);
    const pending = (await P.get('/platform/invoices?status=OPEN').expect(200)).body;
    expect(pending[0]).toMatchObject({ id: invoiceId, paymentReference: 'HBL-TRX-5521' });
    expect(pending[0].tenant.slug).toBe(slugA);
  });

  it('activates the company when its invoice is marked paid', async () => {
    const res = await P.post(`/platform/invoices/${invoiceId}/mark-paid`).expect(201);
    expect(res.body.invoice.status).toBe('PAID');
    expect(res.body.tenant).toMatchObject({ status: 'ACTIVE', plan: 'enterprise', state: 'active', access: 'full' });
    expect(res.body.tenant.currentPeriodEnd).toBe(res.body.invoice.periodEnd);
    await P.post(`/platform/invoices/${invoiceId}/mark-paid`).expect(400);
    await A().post('/contacts', { name: 'Works again' }).expect(201);
    const stats = (await P.get('/platform/stats').expect(200)).body;
    expect(Number(stats.mrr)).toBeGreaterThanOrEqual(39999);
    expect(Number(stats.paidThisMonth)).toBeGreaterThanOrEqual(39999);
  });

  it('gives a grace period after the paid period, then goes read-only', async () => {
    await setTenant({ currentPeriodEnd: new Date(Date.now() - 2 * DAY) });
    const overview = (await A().get('/billing')).body;
    expect(overview).toMatchObject({ state: 'past_due', access: 'full', daysLeft: 5 });
    // Opening the billing page issues the overdue renewal invoice.
    const renewal = overview.invoices.find((i: { status: string }) => i.status === 'OPEN');
    expect(renewal).toMatchObject({ planCode: 'enterprise' });
    await P.post(`/platform/invoices/${renewal.id}/void`).expect(201);
    await A().post('/contacts', { name: 'Still fine' }).expect(201);
    await setTenant({ currentPeriodEnd: new Date(Date.now() - 10 * DAY) });
    expect((await A().post('/contacts', { name: 'No' }).expect(402)).body.state).toBe('expired');
  });

  it('issues renewal invoices a week before the period ends, once', async () => {
    const end = new Date(Date.now() + 3 * DAY);
    await setTenant({ currentPeriodEnd: end });
    const first = (await P.post('/platform/invoices/renewals').expect(201)).body;
    const mine = first.invoices.find((i: { tenantId: string }) => i.tenantId === tenantA);
    expect(mine).toMatchObject({ planCode: 'enterprise', status: 'OPEN' });
    expect(new Date(mine.periodStart).toISOString()).toBe(end.toISOString());
    const again = (await P.post('/platform/invoices/renewals').expect(201)).body;
    expect(again.invoices.find((i: { tenantId: string }) => i.tenantId === tenantA)).toBeUndefined();
    await P.post(`/platform/invoices/${mine.id}/void`).expect(201);
    await P.post(`/platform/invoices/${mine.id}/void`).expect(400);
  });

  it('suspends and reinstates a company', async () => {
    await P.patch(`/platform/tenants/${tenantA}`, { status: 'SUSPENDED', statusNote: 'Chargeback' }).expect(200);
    const res = await A().post('/contacts', { name: 'No' }).expect(402);
    expect(res.body.state).toBe('suspended');
    expect((await A().get('/billing')).body.statusNote).toBe('Chargeback');
    await P.patch(`/platform/tenants/${tenantA}`, { status: 'ACTIVE', statusNote: null }).expect(200);
    await A().post('/contacts', { name: 'Back' }).expect(201);
    await P.patch(`/platform/tenants/${tenantA}`, { plan: 'nope' }).expect(400);
  });

  it('manages plans', async () => {
    const created = await P.post('/platform/plans', { code: planCode, name: 'Test', priceMonthly: 999.5, maxUsers: 2 }).expect(201);
    await P.post('/platform/plans', { code: planCode, name: 'Dup', priceMonthly: 1 }).expect(409);
    await P.patch(`/platform/plans/${created.body.id}`, { active: false, priceMonthly: 1200 }).expect(200);
    const offered = (await A().get('/billing')).body.plans.map((p: { code: string }) => p.code);
    expect(offered).not.toContain(planCode);
    await A().post('/billing/checkout', { planCode }).expect(400);
  });
});

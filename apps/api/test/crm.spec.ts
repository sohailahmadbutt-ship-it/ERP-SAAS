import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const run = Date.now().toString(36);
const slugA = `ca-${run}`;
const slugB = `cb-${run}`;

describe('CRM pipeline', () => {
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
  let rep: ReturnType<typeof as>;
  let repId: string;
  let stages: Record<string, string>;
  let lead: string;
  let other: string;

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
    repId = (await A().post('/users', { name: 'Rep', email: 'rep@a.test', password: 'password123' }).expect(201)).body.id;
    const login = await request(app.getHttpServer()).post('/auth/login').set('X-Tenant', slugA).send({ email: 'rep@a.test', password: 'password123' });
    rep = as(slugA, () => login.body.token);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('starts every company with a pipeline', async () => {
    const list = (await A().get('/crm/stages').expect(200)).body;
    expect(list.map((s: { name: string }) => s.name)).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
    stages = Object.fromEntries(list.map((s: { name: string; id: string }) => [s.name, s.id]));
    await rep.post('/crm/stages', { name: 'Demo', probability: 50 }).expect(403);
    const demo = (await A().post('/crm/stages', { name: 'Demo booked', probability: 45 }).expect(201)).body;
    expect(demo.position).toBe(5); // before Won and Lost
    const after = (await A().get('/crm/stages')).body.map((s: { name: string }) => s.name);
    expect(after).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Demo booked', 'Won', 'Lost']);
    await A().patch(`/crm/stages/${stages.Won}`, { archived: true }).expect(400);
  });

  it('creates prospects in the first stage, owned by whoever adds them', async () => {
    const res = await rep
      .post('/crm/leads', { title: '50 laptops for Lahore office', companyName: 'Indus Textiles', personName: 'Bilal Ahmed', email: 'bilal@indus.test', phone: '0300-1234567', source: 'Website', expectedRevenue: 7500000, priority: 2 })
      .expect(201);
    expect(res.body).toMatchObject({ ownerId: repId, expectedRevenue: '7500000', stage: { name: 'New' }, closedAt: null });
    lead = res.body.id;
    other = (await A().post('/crm/leads', { title: 'Annual support', personName: 'Sara', expectedRevenue: 200000, stageId: stages.Proposal, ownerId: null }).expect(201)).body.id;
    await A().post('/crm/leads', { title: 'Bad owner', ownerId: '00000000-0000-0000-0000-000000000000' }).expect(400);
  });

  it('moves leads along the pipeline and searches them', async () => {
    const moved = (await rep.patch(`/crm/leads/${lead}`, { stageId: stages.Qualified, expectedClose: '2026-12-15' }).expect(200)).body;
    expect(moved.stage.name).toBe('Qualified');
    expect(moved.expectedClose).toMatch(/^2026-12-15/);
    expect((await A().get('/crm/leads?q=indus')).body.map((l: { id: string }) => l.id)).toEqual([lead]);
    expect((await A().get(`/crm/leads?ownerId=${repId}`)).body).toHaveLength(1);
  });

  it('plans and completes activities', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const call = (await rep.post(`/crm/leads/${lead}/activities`, { type: 'CALL', summary: 'Call Bilal about specs', dueAt: yesterday }).expect(201)).body;
    expect(call).toMatchObject({ assignedToId: repId, doneAt: null });
    const note = (await rep.post(`/crm/leads/${lead}/activities`, { type: 'NOTE', summary: 'Wants delivery before January' }).expect(201)).body;
    expect(note.doneAt).not.toBeNull();
    await A().post(`/crm/leads/${other}/activities`, { type: 'MEETING', summary: 'Demo', dueAt: new Date(Date.now() + 3 * 86400000).toISOString() }).expect(201);

    const overdue = (await rep.get('/crm/activities?mine=true&when=overdue').expect(200)).body;
    expect(overdue.map((a: { id: string }) => a.id)).toEqual([call.id]);
    expect(overdue[0].lead.title).toBe('50 laptops for Lahore office');
    expect((await rep.get('/crm/activities?mine=true&when=upcoming')).body).toHaveLength(0);
    const board = (await A().get('/crm/leads')).body;
    expect(board.find((l: { id: string }) => l.id === lead).activities[0].id).toBe(call.id);

    await rep.patch(`/crm/activities/${call.id}`, { done: true }).expect(200);
    expect((await rep.get('/crm/activities?mine=true&when=overdue')).body).toHaveLength(0);
    expect((await A().get(`/crm/leads/${lead}`)).body.activities).toHaveLength(2);
  });

  it('turns a prospect into a customer and a draft quotation', async () => {
    const res = (await rep.post(`/crm/leads/${lead}/quotation`).expect(201)).body;
    expect(res.contact).toMatchObject({ name: 'Indus Textiles', email: 'bilal@indus.test' });
    expect(res.salesOrder).toMatchObject({ status: 'QUOTATION' });
    expect(res.salesOrder.number).toMatch(/^SO-\d{5}$/);
    const contact = (await A().get(`/contacts/${res.contact.id}`)).body;
    expect(contact).toMatchObject({ isCustomer: true, kind: 'COMPANY' });
    await rep.post(`/crm/leads/${lead}/quotation`).expect(400);
    await A().post('/crm/leads', { title: 'No name' }).expect(201).then((r) => A().post(`/crm/leads/${r.body.id}/quotation`).expect(400));
  });

  it('wins and loses leads, and reopens them', async () => {
    const won = (await rep.post(`/crm/leads/${lead}/won`).expect(201)).body;
    expect(won.stage.isWon).toBe(true);
    expect(won.closedAt).not.toBeNull();
    const lost = (await A().post(`/crm/leads/${other}/lost`, { reason: 'Chose a competitor' }).expect(201)).body;
    expect(lost).toMatchObject({ lostReason: 'Chose a competitor', stage: { name: 'Lost' } });
    expect((await A().get('/crm/leads')).body.map((l: { id: string }) => l.id)).not.toContain(lead);
    expect((await A().get('/crm/leads?status=won')).body.map((l: { id: string }) => l.id)).toEqual([lead]);

    const reopened = (await A().patch(`/crm/leads/${other}`, { stageId: stages.Negotiation }).expect(200)).body;
    expect(reopened).toMatchObject({ closedAt: null, lostReason: null });
  });

  it('summarises the pipeline', async () => {
    const s = (await A().get('/crm/summary').expect(200)).body;
    const row = (name: string) => s.stages.find((r: { stage: { name: string } }) => r.stage.name === name);
    expect(row('Negotiation')).toMatchObject({ count: 1, value: '200000', weighted: '160000' });
    expect(s.wonThisMonth).toMatchObject({ count: 1, value: '7500000' });
    expect(s.open.count).toBe(2); // Annual support + the unnamed lead
  });

  it('keeps each company’s pipeline private', async () => {
    expect((await B().get('/crm/leads?status=all')).body).toHaveLength(0);
    await B().get(`/crm/leads/${lead}`).expect(404);
    await B().patch(`/crm/leads/${lead}`, { title: 'x' }).expect(404);
    await B().post('/crm/leads', { title: 'Steal', stageId: stages.New }).expect(400);
    await B().post(`/crm/leads/${lead}/activities`, { type: 'NOTE', summary: 'x' }).expect(404);
  });
});

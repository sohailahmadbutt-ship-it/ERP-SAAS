import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const run = Date.now().toString(36);
const slugA = `a-${run}`;
const slugB = `b-${run}`;

describe('multi-tenant signup, auth and isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  const signup = (slug: string, email: string) =>
    request(app.getHttpServer())
      .post('/auth/signup')
      .send({ companyName: `Company ${slug}`, slug, name: 'Owner', email, password: 'password123' });

  it('signs up two companies', async () => {
    const a = await signup(slugA, 'owner@a.test').expect(201);
    const b = await signup(slugB, 'owner@b.test').expect(201);
    tokenA = a.body.token;
    tokenB = b.body.token;
    expect(a.body.user.role).toBe('OWNER');
    expect(a.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a taken or reserved company address', async () => {
    await signup(slugA, 'other@a.test').expect(409);
    await signup('admin', 'x@x.test').expect(400);
  });

  it('logs in by subdomain and by header', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Host', `${slugA}.localhost`)
      .send({ email: 'owner@a.test', password: 'password123' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Tenant', slugA)
      .send({ email: 'owner@a.test', password: 'wrong-password' })
      .expect(401);
  });

  it('does not let a user log in to another company', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Tenant', slugB)
      .send({ email: 'owner@a.test', password: 'password123' })
      .expect(401);
  });

  it('rejects a token used against a different company', async () => {
    await request(app.getHttpServer()).get('/users').set('X-Tenant', slugB).set('Authorization', `Bearer ${tokenA}`).expect(401);
  });

  it('only lists users of the current company', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('X-Tenant', slugA)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Clerk', email: 'clerk@a.test', password: 'password123' })
      .expect(201);
    const a = await request(app.getHttpServer()).get('/users').set('X-Tenant', slugA).set('Authorization', `Bearer ${tokenA}`).expect(200);
    const b = await request(app.getHttpServer()).get('/users').set('X-Tenant', slugB).set('Authorization', `Bearer ${tokenB}`).expect(200);
    expect(a.body.map((u: { email: string }) => u.email).sort()).toEqual(['clerk@a.test', 'owner@a.test']);
    expect(b.body.map((u: { email: string }) => u.email)).toEqual(['owner@b.test']);
  });

  it('stops members from adding users', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Tenant', slugA)
      .send({ email: 'clerk@a.test', password: 'password123' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/users')
      .set('X-Tenant', slugA)
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ name: 'X', email: 'x@a.test', password: 'password123' })
      .expect(403);
  });

  it('enforces isolation in the database itself, not just the API', async () => {
    // Without a tenant set, row-level security hides every user row.
    expect(await prisma.user.count()).toBe(0);
    const tenantB = await prisma.tenant.findUniqueOrThrow({ where: { slug: slugB } });
    const seen = await prisma.withTenant(tenantB.id, (tx) => tx.user.findMany());
    expect(seen.every((u) => u.tenantId === tenantB.id)).toBe(true);
  });
});

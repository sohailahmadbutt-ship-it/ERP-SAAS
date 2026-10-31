# ERP SaaS

A multi-tenant cloud ERP: every company signs up, gets its own subdomain
(`acme.yourdomain.com`) and an isolated workspace for sales, purchasing,
inventory and accounting.

This is an original codebase. It does not use or derive from Odoo.

## Stack

- **API:** NestJS + Prisma on PostgreSQL (`apps/api`), OpenAPI docs at `/docs`
- **Web:** Next.js (`apps/web`)
- **Tenant isolation:** every tenant-scoped table has a `tenant_id` and a
  Postgres row-level security policy. The API runs each request's queries in a
  transaction with `app.tenant_id` set (`PrismaService.withTenant`), so a bug
  in application code still can't read another company's rows.

## Running locally

```bash
cp .env.example .env            # and apps/api/.env with DATABASE_URL
docker compose up -d            # Postgres (with the erp_app role) + Redis
pnpm install
pnpm db:migrate
pnpm dev                        # API on :4000, web on :3000
```

Open http://localhost:3000/signup and create a company, for example `acme`.
You'll land on http://acme.localhost:3000/app (browsers resolve `*.localhost`
to your machine).

Run the tests (needs the database up): `pnpm test`.

## Adding a tenant-scoped table

1. Add the model with a `tenantId` field in `apps/api/prisma/schema.prisma`.
2. `npx prisma migrate dev --create-only --name <name>`, then append to the
   migration:
   ```sql
   ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON "<table>"
     USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
     WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
   ```
3. Always query it inside `prisma.withTenant(tenant.id, tx => ...)`.
4. When it references another tenant-scoped table, use a composite foreign
   key so the database rejects links across companies (plain foreign key
   checks bypass row-level security). Give the referenced model
   `@@unique([id, tenantId])` and write the relation as
   `@relation(fields: [productId, tenantId], references: [id, tenantId], onDelete: NoAction)`.

## Roadmap

1. ✅ Monorepo, CI, tenant signup, subdomain routing, auth, users and roles
2. ✅ Company settings, contacts (customers, vendors, people at a company)
3. ✅ Products, units, warehouses, stock moves (receipts, deliveries, transfers, counts)
4. ✅ Sales: quotation → order → delivery → invoice → payment, taxes, printable documents
5. Purchase: RFQ → order → bill, receipts
6. Accounting: ledger, payments, financial reports
7. Subscription billing and platform admin console
8. Point of Sale, CRM

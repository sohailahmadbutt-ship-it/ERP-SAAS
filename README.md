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

## Subscriptions and the platform console

Every new company starts a 14-day trial on the plan it picks (Business by default). Plans and their prices live in the `plans` table and are edited from the console.

- Owners choose a plan under **Settings > Billing**. Subscribing issues a monthly invoice (`PINV-00001`, ...). Payment is offline for now: the owner pays by bank transfer or wallet and enters the reference, and the platform marks the invoice paid from the console, which activates the company until the end of that period.
- Renewal invoices are issued a week before a paid period ends: when the owner opens Billing, or for everyone at once with **Issue renewal invoices** in the console.
- After a paid period ends there is a 7-day grace period. When a trial or grace period runs out, or the platform suspends or cancels a company, it becomes read-only: reads still work, but every change returns `402` until it pays. Billing itself always works.
- Each plan can cap the number of users.

The console is at `/platform` on the main domain (never on a company subdomain). Create the first admin after building the API:

```bash
cd apps/api && pnpm build
PLATFORM_ADMIN_PASSWORD='at-least-12-characters' pnpm platform:create-admin you@example.com "Your Name"
```

Console tokens carry a `platform` scope and never work on company routes, and company tokens never work on `/platform`. Console queries run through `PrismaService.asPlatform`, which lets Postgres show every company's platform invoices and read its users. Every other tenant table stays hidden from it.

Set `PAYMENT_INSTRUCTIONS` to the bank account details companies should pay into.

## Roadmap

1. ✅ Monorepo, CI, tenant signup, subdomain routing, auth, users and roles
2. ✅ Company settings, contacts (customers, vendors, people at a company)
3. ✅ Products, units, warehouses, stock moves (receipts, deliveries, transfers, counts)
4. ✅ Sales: quotation → order → delivery → invoice → payment, taxes, printable documents
5. ✅ Purchase: RFQ → order → receipt (average cost) → vendor bill → payment
6. ✅ Accounting: chart of accounts, automatic double-entry postings, journal, ledger, P&L, balance sheet, trial balance
7. ✅ Subscription billing and platform admin console: plans, 14-day trials, user limits, invoices paid by bank transfer, read-only mode when unpaid
8. ✅ Point of sale: registers, cashier shifts, barcode scanning, tax-inclusive prices, split payments, receipts, refunds, cash counts
9. CRM: leads, pipeline, activities

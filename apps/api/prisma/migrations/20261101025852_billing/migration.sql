-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "current_period_end" TIMESTAMP(3),
ADD COLUMN     "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
ADD COLUMN     "status_note" TEXT,
ADD COLUMN     "trial_ends_at" TIMESTAMP(3),
ALTER COLUMN "plan" SET DEFAULT 'business';

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_monthly" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "max_users" INTEGER,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_code" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "payment_reference" TEXT,
    "reported_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_number_key" ON "platform_invoices"("number");

-- CreateIndex
CREATE INDEX "platform_invoices_tenant_id_status_idx" ON "platform_invoices"("tenant_id", "status");

-- Starter plans. The platform console can edit prices and limits later.
INSERT INTO "plans" ("id", "code", "name", "price_monthly", "max_users", "description", "sort_order") VALUES
  (gen_random_uuid(), 'starter', 'Starter', 4999, 3, 'For small shops: sales, purchasing, inventory and accounting for up to 3 users.', 1),
  (gen_random_uuid(), 'business', 'Business', 14999, 15, 'For growing companies with up to 15 users.', 2),
  (gen_random_uuid(), 'enterprise', 'Enterprise', 39999, NULL, 'Unlimited users.', 3);

-- Existing companies move to a 14-day Business trial.
UPDATE "tenants" SET "plan" = 'business', "status" = 'TRIALING', "trial_ends_at" = now() + interval '14 days';

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_fkey" FOREIGN KEY ("plan") REFERENCES "plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Global numbering for platform invoices (PINV-00001, ...).
CREATE SEQUENCE "platform_invoice_number_seq";

-- Platform invoices belong to a company, so they get the tenant policy. The
-- platform console sets app.platform = 'on' to see every company's invoices.
ALTER TABLE "platform_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "platform_invoices"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

-- The console also needs to count and list each company's users (read only).
CREATE POLICY platform_read ON "users" FOR SELECT USING (current_setting('app.platform', true) = 'on');

-- CreateEnum
CREATE TYPE "PosSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PosOrderStatus" AS ENUM ('PAID', 'REFUNDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalSource" ADD VALUE 'POS_ORDER';
ALTER TYPE "JournalSource" ADD VALUE 'POS_SESSION';

-- CreateTable
CREATE TABLE "pos_registers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "tax_id" UUID,
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT true,
    "receipt_footer" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "register_id" UUID NOT NULL,
    "status" "PosSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opening_cash" DECIMAL(14,2) NOT NULL,
    "opened_by_id" UUID NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_cash" DECIMAL(14,2),
    "counted_cash" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "closing_note" TEXT,
    "closed_by_id" UUID,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "pos_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" "PosOrderStatus" NOT NULL DEFAULT 'PAID',
    "refund_of_id" UUID,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax_total" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "tendered" DECIMAL(14,2) NOT NULL,
    "change" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_order_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pos_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,

    CONSTRAINT "pos_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_registers_id_tenant_id_key" ON "pos_registers"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sessions_id_tenant_id_key" ON "pos_sessions"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sessions_tenant_id_number_key" ON "pos_sessions"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "pos_orders_tenant_id_session_id_idx" ON "pos_orders"("tenant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_orders_id_tenant_id_key" ON "pos_orders"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_orders_tenant_id_number_key" ON "pos_orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "pos_order_lines_tenant_id_order_id_idx" ON "pos_order_lines"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "pos_payments_tenant_id_order_id_idx" ON "pos_payments"("tenant_id", "order_id");

-- AddForeignKey
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_warehouse_id_tenant_id_fkey" FOREIGN KEY ("warehouse_id", "tenant_id") REFERENCES "warehouses"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_tax_id_tenant_id_fkey" FOREIGN KEY ("tax_id", "tenant_id") REFERENCES "taxes"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_register_id_tenant_id_fkey" FOREIGN KEY ("register_id", "tenant_id") REFERENCES "pos_registers"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_session_id_tenant_id_fkey" FOREIGN KEY ("session_id", "tenant_id") REFERENCES "pos_sessions"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_customer_id_tenant_id_fkey" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "contacts"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_refund_of_id_tenant_id_fkey" FOREIGN KEY ("refund_of_id", "tenant_id") REFERENCES "pos_orders"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_lines" ADD CONSTRAINT "pos_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_lines" ADD CONSTRAINT "pos_order_lines_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "pos_orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_order_lines" ADD CONSTRAINT "pos_order_lines_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_payments" ADD CONSTRAINT "pos_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_payments" ADD CONSTRAINT "pos_payments_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "pos_orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A register can have only one open session at a time.
CREATE UNIQUE INDEX "pos_sessions_one_open_per_register" ON "pos_sessions"("register_id") WHERE "status" = 'OPEN';

-- Row-level security on every new tenant-scoped table (see the README).
ALTER TABLE "pos_registers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_registers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pos_registers"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "pos_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pos_sessions"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "pos_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pos_orders"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "pos_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pos_order_lines"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "pos_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pos_payments"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

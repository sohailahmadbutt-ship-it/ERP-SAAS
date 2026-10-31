-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('COMPANY', 'PERSON');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'PK',
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "tax_id" TEXT;

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "ContactKind" NOT NULL DEFAULT 'COMPANY',
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "tax_id" TEXT,
    "is_customer" BOOLEAN NOT NULL DEFAULT false,
    "is_vendor" BOOLEAN NOT NULL DEFAULT false,
    "credit_limit" DECIMAL(14,2),
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_tenant_id_name_idx" ON "contacts"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security, same policy as users (see the README).
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contacts"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

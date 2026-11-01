-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('CALL', 'MEETING', 'EMAIL', 'TASK', 'NOTE');

-- CreateTable
CREATE TABLE "crm_stages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "is_won" BOOLEAN NOT NULL DEFAULT false,
    "is_lost" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "crm_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "stage_id" UUID NOT NULL,
    "contact_id" UUID,
    "company_name" TEXT,
    "person_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "owner_id" UUID,
    "expected_revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expected_close" DATE,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "lost_reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "sales_order_id" UUID,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" "CrmActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "assigned_to_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_stages_id_tenant_id_key" ON "crm_stages"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "crm_leads_tenant_id_stage_id_idx" ON "crm_leads"("tenant_id", "stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_id_tenant_id_key" ON "crm_leads"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "crm_activities_tenant_id_lead_id_idx" ON "crm_activities"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "crm_activities_tenant_id_assigned_to_id_done_at_idx" ON "crm_activities"("tenant_id", "assigned_to_id", "done_at");

-- AddForeignKey
ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_stage_id_tenant_id_fkey" FOREIGN KEY ("stage_id", "tenant_id") REFERENCES "crm_stages"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_contact_id_tenant_id_fkey" FOREIGN KEY ("contact_id", "tenant_id") REFERENCES "contacts"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_sales_order_id_tenant_id_fkey" FOREIGN KEY ("sales_order_id", "tenant_id") REFERENCES "sales_orders"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_lead_id_tenant_id_fkey" FOREIGN KEY ("lead_id", "tenant_id") REFERENCES "crm_leads"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security on every new tenant-scoped table (see the README).
ALTER TABLE "crm_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_stages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "crm_stages"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "crm_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "crm_leads"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "crm_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "crm_activities"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

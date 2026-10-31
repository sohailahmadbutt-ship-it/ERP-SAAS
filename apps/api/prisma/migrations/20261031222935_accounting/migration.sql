-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'INVOICE', 'INVOICE_PAYMENT', 'BILL', 'BILL_PAYMENT', 'STOCK');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "system_key" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "memo" TEXT,
    "source" "JournalSource" NOT NULL,
    "source_id" UUID,
    "reference" TEXT,
    "reverses_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "contact_id" UUID,
    "description" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "date" DATE NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_id_tenant_id_key" ON "accounts"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_code_key" ON "accounts"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_system_key_key" ON "accounts"("tenant_id", "system_key");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_date_idx" ON "journal_entries"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_source_source_id_idx" ON "journal_entries"("tenant_id", "source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_id_tenant_id_key" ON "journal_entries"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tenant_id_number_key" ON "journal_entries"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "journal_lines_tenant_id_account_id_date_idx" ON "journal_lines"("tenant_id", "account_id", "date");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_tenant_id_fkey" FOREIGN KEY ("entry_id", "tenant_id") REFERENCES "journal_entries"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_tenant_id_fkey" FOREIGN KEY ("account_id", "tenant_id") REFERENCES "accounts"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_contact_id_tenant_id_fkey" FOREIGN KEY ("contact_id", "tenant_id") REFERENCES "contacts"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Every entry must balance; checked by the database at commit time, so no
-- code path can leave the books out of balance.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amounts_check"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND NOT ("debit" > 0 AND "credit" > 0));

CREATE FUNCTION journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  diff numeric;
  eid uuid := COALESCE(NEW.entry_id, OLD.entry_id);
BEGIN
  SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) INTO diff FROM journal_lines WHERE entry_id = eid;
  IF diff <> 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance (difference %)', eid, diff;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- Row-level security on every new tenant-scoped table (see the README).
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "accounts"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "journal_entries"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "journal_lines"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

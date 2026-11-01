import type { AccountType } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';

export type SystemKey =
  | 'CASH' | 'BANK' | 'RECEIVABLE' | 'INVENTORY' | 'TAX_INPUT'
  | 'PAYABLE' | 'TAX_OUTPUT' | 'GRNI' | 'EQUITY'
  | 'SALES' | 'COGS' | 'STOCK_ADJUSTMENT' | 'EXPENSES' | 'CASH_DIFFERENCE';

/** Starter chart of accounts. Companies can rename these and add their own. */
export const DEFAULT_ACCOUNTS: { code: string; name: string; type: AccountType; systemKey: SystemKey }[] = [
  { code: '1000', name: 'Cash', type: 'ASSET', systemKey: 'CASH' },
  { code: '1010', name: 'Bank', type: 'ASSET', systemKey: 'BANK' },
  { code: '1100', name: 'Accounts receivable', type: 'ASSET', systemKey: 'RECEIVABLE' },
  { code: '1200', name: 'Inventory', type: 'ASSET', systemKey: 'INVENTORY' },
  { code: '1300', name: 'Sales tax paid (input)', type: 'ASSET', systemKey: 'TAX_INPUT' },
  { code: '2000', name: 'Accounts payable', type: 'LIABILITY', systemKey: 'PAYABLE' },
  { code: '2100', name: 'Sales tax collected (output)', type: 'LIABILITY', systemKey: 'TAX_OUTPUT' },
  { code: '2200', name: 'Goods received, not yet billed', type: 'LIABILITY', systemKey: 'GRNI' },
  { code: '3000', name: "Owner's equity", type: 'EQUITY', systemKey: 'EQUITY' },
  { code: '4000', name: 'Sales', type: 'INCOME', systemKey: 'SALES' },
  { code: '5000', name: 'Cost of goods sold', type: 'EXPENSE', systemKey: 'COGS' },
  { code: '5100', name: 'Stock adjustments', type: 'EXPENSE', systemKey: 'STOCK_ADJUSTMENT' },
  { code: '6000', name: 'General expenses', type: 'EXPENSE', systemKey: 'EXPENSES' },
  { code: '6100', name: 'Cash over and short', type: 'EXPENSE', systemKey: 'CASH_DIFFERENCE' },
];

/** Creates any missing system accounts. Must run inside a tenant transaction. */
export async function ensureAccounts(tx: Tx, tenantId: string) {
  const existing = await tx.account.findMany({ where: { systemKey: { not: null } }, select: { systemKey: true } });
  const have = new Set(existing.map((a) => a.systemKey));
  const missing = DEFAULT_ACCOUNTS.filter((a) => !have.has(a.systemKey));
  if (missing.length) {
    // skipDuplicates covers a concurrent request seeding at the same moment
    // (and a user account that already took one of the codes).
    await tx.account.createMany({ data: missing.map((a) => ({ ...a, tenantId })), skipDuplicates: true });
  }
}

/** Debits increase these; credits increase the rest. */
export const DEBIT_NORMAL: AccountType[] = ['ASSET', 'EXPENSE'];

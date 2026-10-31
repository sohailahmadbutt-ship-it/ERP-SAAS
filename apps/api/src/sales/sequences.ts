import type { Tx } from '../prisma/prisma.service';

/**
 * Next document number for a company, e.g. SO-00001. The upsert takes a row
 * lock, so concurrent callers get distinct numbers, and a rolled-back
 * transaction gives its number back.
 */
export async function nextNumber(tx: Tx, tenantId: string, key: string) {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    INSERT INTO sequences (tenant_id, key, next) VALUES (${tenantId}::uuid, ${key}, 2)
    ON CONFLICT (tenant_id, key) DO UPDATE SET next = sequences.next + 1
    RETURNING next - 1 AS n`;
  return `${key}-${String(rows[0].n).padStart(5, '0')}`;
}

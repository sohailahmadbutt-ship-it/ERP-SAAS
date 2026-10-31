import type { Tx } from '../prisma/prisma.service';

export const DEFAULT_UNITS = [
  { code: 'pcs', name: 'Pieces' },
  { code: 'box', name: 'Box' },
  { code: 'kg', name: 'Kilogram' },
  { code: 'g', name: 'Gram' },
  { code: 'l', name: 'Litre' },
  { code: 'm', name: 'Metre' },
  { code: 'hr', name: 'Hour' },
];

/**
 * Gives a company a starter set of units and one warehouse. Runs at signup,
 * and lazily for companies created before inventory existed. Must be called
 * inside a tenant transaction.
 */
export async function ensureInventoryDefaults(tx: Tx, tenantId: string) {
  if ((await tx.unit.count()) === 0) {
    await tx.unit.createMany({ data: DEFAULT_UNITS.map((u) => ({ ...u, tenantId })), skipDuplicates: true });
  }
  if ((await tx.warehouse.count()) === 0) {
    await tx.warehouse.createMany({ data: [{ tenantId, code: 'WH', name: 'Main warehouse' }], skipDuplicates: true });
  }
}

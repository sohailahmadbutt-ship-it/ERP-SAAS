import type { Tx } from '../prisma/prisma.service';

/** Starter tax rate (Pakistan's standard sales tax). Editable in settings. */
export async function ensureSalesDefaults(tx: Tx, tenantId: string) {
  if ((await tx.tax.count()) === 0) {
    await tx.tax.create({ data: { tenantId, name: 'GST 18%', rate: 18 } });
  }
}

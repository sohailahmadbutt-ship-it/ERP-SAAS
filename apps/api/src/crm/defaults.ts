import type { Tx } from '../prisma/prisma.service';

/** Starter pipeline. Companies can rename stages, change probabilities and add their own. */
export const DEFAULT_STAGES = [
  { name: 'New', probability: 10 },
  { name: 'Qualified', probability: 30 },
  { name: 'Proposal', probability: 60 },
  { name: 'Negotiation', probability: 80 },
  { name: 'Won', probability: 100, isWon: true },
  { name: 'Lost', probability: 0, isLost: true },
];

/** Creates the starter pipeline for a company that has none. Must run inside a tenant transaction. */
export async function ensureCrmStages(tx: Tx, tenantId: string) {
  // Serialise per company so two first visits don't both seed.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('crm-stages:' || ${tenantId}))`;
  if (await tx.crmStage.count()) return;
  await tx.crmStage.createMany({ data: DEFAULT_STAGES.map((s, i) => ({ ...s, tenantId, position: i + 1 })) });
}

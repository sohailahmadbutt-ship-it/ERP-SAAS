import { Prisma, type Plan, type Tenant } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';

export const TRIAL_DAYS = 14;
/** Days after a paid period ends during which the company can still work normally. */
export const GRACE_DAYS = 7;
/** Renewal invoices are issued this many days before the paid period ends. */
export const RENEWAL_LEAD_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

export type SubscriptionState = 'trial' | 'trial_expired' | 'active' | 'past_due' | 'expired' | 'suspended' | 'canceled';

export interface Access {
  state: SubscriptionState;
  /** read_only blocks every change except paying for the subscription. */
  access: 'full' | 'read_only';
  /** Trial days left, or grace days left when past due. */
  daysLeft: number | null;
}

const daysUntil = (d: Date, now: Date) => Math.max(0, Math.ceil((d.getTime() - now.getTime()) / DAY));

export function accessOf(t: Pick<Tenant, 'status' | 'trialEndsAt' | 'currentPeriodEnd'>, now = new Date()): Access {
  switch (t.status) {
    case 'SUSPENDED':
      return { state: 'suspended', access: 'read_only', daysLeft: null };
    case 'CANCELED':
      return { state: 'canceled', access: 'read_only', daysLeft: null };
    case 'TRIALING':
      if (!t.trialEndsAt || t.trialEndsAt > now) {
        return { state: 'trial', access: 'full', daysLeft: t.trialEndsAt ? daysUntil(t.trialEndsAt, now) : null };
      }
      return { state: 'trial_expired', access: 'read_only', daysLeft: 0 };
    case 'ACTIVE': {
      if (!t.currentPeriodEnd || t.currentPeriodEnd > now) return { state: 'active', access: 'full', daysLeft: null };
      const graceEnd = new Date(t.currentPeriodEnd.getTime() + GRACE_DAYS * DAY);
      if (graceEnd > now) return { state: 'past_due', access: 'full', daysLeft: daysUntil(graceEnd, now) };
      return { state: 'expired', access: 'read_only', daysLeft: 0 };
    }
  }
}

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** Same day next month, clamped to the month's last day (31 Jan -> 28/29 Feb). */
export function addMonths(d: Date, n: number) {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

/** When a newly bought period should start: after any time the company already has. */
export function nextPeriodStart(t: Pick<Tenant, 'status' | 'trialEndsAt' | 'currentPeriodEnd'>, now = new Date()) {
  let start = now;
  if (t.status === 'TRIALING' && t.trialEndsAt && t.trialEndsAt > start) start = t.trialEndsAt;
  if (t.status === 'ACTIVE' && t.currentPeriodEnd && t.currentPeriodEnd > start) start = t.currentPeriodEnd;
  return start;
}

/**
 * Issues an invoice for one month of `plan`. The caller's transaction must be
 * allowed to write the company's rows (withTenant or asPlatform).
 */
export async function issueInvoice(tx: Tx, tenant: Tenant, plan: Plan, periodStart: Date) {
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('platform_invoice_number_seq') AS n`;
  const now = new Date();
  return tx.platformInvoice.create({
    data: {
      number: `PINV-${String(n).padStart(5, '0')}`,
      tenantId: tenant.id,
      planCode: plan.code,
      planName: plan.name,
      amount: plan.priceMonthly,
      currency: plan.currency,
      periodStart,
      periodEnd: addMonths(periodStart, 1),
      dueDate: periodStart > now ? periodStart : addDays(now, GRACE_DAYS),
    },
  });
}

/**
 * Creates the next month's invoice for an active company whose paid period
 * ends soon, unless one is already open. Returns the new invoice, if any.
 */
export async function ensureRenewal(tx: Tx, tenant: Tenant & { planRef: Plan }, now = new Date()) {
  if (tenant.status !== 'ACTIVE' || !tenant.currentPeriodEnd) return null;
  if (tenant.currentPeriodEnd > addDays(now, RENEWAL_LEAD_DAYS)) return null;
  const open = await tx.platformInvoice.count({ where: { tenantId: tenant.id, status: 'OPEN' } });
  if (open) return null;
  return issueInvoice(tx, tenant, tenant.planRef, tenant.currentPeriodEnd);
}

/** Applies a paid invoice: the company becomes active on its plan through the invoice's period. */
export function paidTenantUpdate(tenant: Tenant, inv: { planCode: string; periodEnd: Date }): Prisma.TenantUpdateInput {
  const end = tenant.currentPeriodEnd && tenant.currentPeriodEnd > inv.periodEnd ? tenant.currentPeriodEnd : inv.periodEnd;
  return {
    planRef: { connect: { code: inv.planCode } },
    currentPeriodEnd: end,
    // A suspension is the platform's decision, so paying doesn't lift it.
    ...(tenant.status === 'SUSPENDED' ? {} : { status: 'ACTIVE', statusNote: null }),
  };
}

/** A readable message if the company has more users than `plan` allows, otherwise null. */
export function userLimitError(plan: Plan, userCount: number) {
  if (plan.maxUsers === null || userCount <= plan.maxUsers) return null;
  return `The ${plan.name} plan allows ${plan.maxUsers} users and you have ${userCount}. Remove users or choose a bigger plan.`;
}

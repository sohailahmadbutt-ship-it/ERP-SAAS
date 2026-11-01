import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;

export const round2 = (d: Dec) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Line amounts: discount applies before tax; each amount rounds to 2 places. */
export function lineAmounts(quantity: Prisma.Decimal.Value, unitPrice: Prisma.Decimal.Value, discountPct: Prisma.Decimal.Value, taxRate: Prisma.Decimal.Value) {
  const gross = new D(quantity).times(unitPrice);
  const subtotal = round2(gross.times(new D(100).minus(discountPct)).div(100));
  const taxAmount = round2(subtotal.times(taxRate).div(100));
  return { subtotal, taxAmount, total: subtotal.plus(taxAmount) };
}

/**
 * Line amounts when the price already includes tax (shelf prices in a shop):
 * the line total is fixed and tax is backed out of it.
 */
export function inclusiveLineAmounts(quantity: Prisma.Decimal.Value, unitPrice: Prisma.Decimal.Value, discountPct: Prisma.Decimal.Value, taxRate: Prisma.Decimal.Value) {
  const total = round2(new D(quantity).times(unitPrice).times(new D(100).minus(discountPct)).div(100));
  const subtotal = round2(total.times(100).div(new D(100).plus(taxRate)));
  return { subtotal, taxAmount: total.minus(subtotal), total };
}

export function sumTotals(lines: { subtotal: Dec; taxAmount: Dec }[]) {
  const subtotal = lines.reduce((a, l) => a.plus(l.subtotal), new D(0));
  const taxTotal = lines.reduce((a, l) => a.plus(l.taxAmount), new D(0));
  return { subtotal, taxTotal, total: subtotal.plus(taxTotal) };
}

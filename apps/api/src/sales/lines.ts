import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';
import { LineInput } from './dto';
import { lineAmounts } from './money';

/**
 * Resolves products and taxes for document lines (inside the tenant
 * transaction, so only this company's rows are visible) and computes amounts.
 */
export async function buildLines(tx: Tx, tenantId: string, input: LineInput[]) {
  const productIds = [...new Set(input.map((l) => l.productId))];
  const taxIds = [...new Set(input.map((l) => l.taxId).filter((t): t is string => !!t))];
  const [products, taxes] = await Promise.all([
    tx.product.findMany({ where: { id: { in: productIds }, archived: false } }),
    tx.tax.findMany({ where: { id: { in: taxIds }, archived: false } }),
  ]);
  const p = new Map(products.map((x) => [x.id, x]));
  const t = new Map(taxes.map((x) => [x.id, x]));
  return input.map((l, i) => {
    const product = p.get(l.productId);
    if (!product) throw new BadRequestException(`Line ${i + 1}: product not found`);
    const tax = l.taxId ? t.get(l.taxId) : undefined;
    if (l.taxId && !tax) throw new BadRequestException(`Line ${i + 1}: tax not found`);
    const unitPrice = l.unitPrice !== undefined ? new Prisma.Decimal(l.unitPrice) : product.salePrice;
    const discountPct = new Prisma.Decimal(l.discountPct ?? 0);
    const taxRate = tax?.rate ?? new Prisma.Decimal(0);
    return {
      tenantId,
      position: i + 1,
      productId: product.id,
      description: l.description?.trim() || product.name,
      quantity: new Prisma.Decimal(l.quantity),
      unitPrice,
      discountPct,
      taxId: tax?.id ?? null,
      taxRate,
      ...lineAmounts(l.quantity, unitPrice, discountPct, taxRate),
    };
  });
}

/** Locks a document row for the rest of the transaction (serialises actions on it). */
export async function lockRow(tx: Tx, table: 'sales_orders' | 'invoices', id: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM ${table} WHERE id = $1::uuid FOR UPDATE`, id);
  return rows.length > 0;
}

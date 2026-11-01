import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PosRegister, type Tax } from '@prisma/client';
import { AccountingService } from '../accounting/accounting.service';
import { StockService } from '../inventory/stock.service';
import type { Tx } from '../prisma/prisma.service';
import { inclusiveLineAmounts, lineAmounts, sumTotals } from '../sales/money';
import { nextNumber } from '../sales/sequences';
import type { CloseSessionInput, PosLineInput, PosMethod, PosOrderInput, PosPaymentInput } from './dto';

const D = Prisma.Decimal;
const ZERO = new D(0);

export const orderInclude = {
  lines: { orderBy: { position: 'asc' } },
  payments: true,
  customer: { select: { id: true, name: true } },
  session: { select: { id: true, number: true, register: { select: { id: true, name: true, receiptFooter: true } } } },
  refundOf: { select: { id: true, number: true } },
  refunds: { select: { id: true, number: true } },
} satisfies Prisma.PosOrderInclude;

@Injectable()
export class PosService {
  constructor(private stock: StockService, private accounting: AccountingService) {}

  /**
   * Locks an open session for the rest of the transaction. Sales take a shared
   * lock so they run side by side; closing takes an exclusive one, so no sale
   * can land in a session while its cash is being counted.
   */
  async openSession(tx: Tx, id: string, mode: 'SHARE' | 'UPDATE') {
    const rows = mode === 'UPDATE'
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM pos_sessions WHERE id = ${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM pos_sessions WHERE id = ${id}::uuid FOR SHARE`;
    if (!rows.length) throw new NotFoundException('Session not found');
    const session = await tx.posSession.findUniqueOrThrow({ where: { id }, include: { register: { include: { tax: true } } } });
    if (session.status !== 'OPEN') throw new BadRequestException('This session is closed');
    return session;
  }

  /** Cash that should be in the drawer: the opening float plus cash kept (net of change and refunds). */
  async expectedCash(tx: Tx, sessionId: string, openingCash: Prisma.Decimal) {
    const cash = await tx.posPayment.aggregate({ where: { method: 'CASH', order: { sessionId } }, _sum: { amount: true } });
    return openingCash.plus(cash._sum.amount ?? ZERO);
  }

  async summary(tx: Tx, sessionId: string) {
    const session = await tx.posSession.findUnique({ where: { id: sessionId }, include: { register: { include: { warehouse: true, tax: true } } } });
    if (!session) throw new NotFoundException();
    const [sales, refunds, byMethod] = await Promise.all([
      tx.posOrder.aggregate({ where: { sessionId, refundOfId: null }, _count: true, _sum: { total: true, taxTotal: true } }),
      tx.posOrder.aggregate({ where: { sessionId, refundOfId: { not: null } }, _count: true, _sum: { total: true } }),
      tx.posPayment.groupBy({ by: ['method'], where: { order: { sessionId } }, _sum: { amount: true } }),
    ]);
    return {
      ...session,
      totals: {
        orders: sales._count,
        sales: sales._sum.total ?? ZERO,
        tax: sales._sum.taxTotal ?? ZERO,
        refunds: refunds._count,
        refunded: (refunds._sum.total ?? ZERO).neg(),
        byMethod: Object.fromEntries(byMethod.map((m) => [m.method, m._sum.amount ?? ZERO])),
      },
      expectedCash: session.status === 'OPEN' ? await this.expectedCash(tx, sessionId, session.openingCash) : session.expectedCash,
    };
  }

  private async buildLines(tx: Tx, register: PosRegister & { tax: Tax | null }, input: PosLineInput[]) {
    const products = await tx.product.findMany({ where: { id: { in: [...new Set(input.map((l) => l.productId))] }, archived: false } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const rate = register.tax && !register.tax.archived ? register.tax.rate : ZERO;
    const amounts = register.pricesIncludeTax ? inclusiveLineAmounts : lineAmounts;
    return input.map((l, i) => {
      const product = byId.get(l.productId);
      if (!product) throw new BadRequestException(`Line ${i + 1}: product not found`);
      const unitPrice = l.unitPrice !== undefined ? new D(l.unitPrice) : product.salePrice;
      const discountPct = new D(l.discountPct ?? 0);
      return {
        position: i + 1,
        productId: product.id,
        productType: product.type,
        description: product.name,
        quantity: new D(l.quantity),
        unitPrice,
        discountPct,
        taxRate: rate,
        ...amounts(l.quantity, unitPrice, discountPct, rate),
      };
    });
  }

  /**
   * Works out what each payment keeps. Only cash can be over the total, and
   * the excess goes back as change.
   */
  private settle(total: Prisma.Decimal, payments: PosPaymentInput[]) {
    const tendered = payments.reduce((a, p) => a.plus(p.amount), ZERO);
    if (tendered.lt(total)) throw new BadRequestException(`Payments of ${tendered} don't cover the total of ${total}`);
    const cash = payments.filter((p) => p.method === 'CASH').reduce((a, p) => a.plus(p.amount), ZERO);
    const change = tendered.minus(total);
    if (change.gt(cash)) throw new BadRequestException('Only cash can be more than the total');
    // Merge payments by method; cash keeps what it took minus the change.
    const kept = new Map<PosMethod, { amount: Prisma.Decimal; reference?: string }>();
    for (const p of payments) {
      const cur = kept.get(p.method);
      kept.set(p.method, { amount: (cur?.amount ?? ZERO).plus(p.amount), reference: cur?.reference ?? p.reference });
    }
    if (kept.has('CASH')) kept.get('CASH')!.amount = cash.minus(change);
    const rows = [...kept.entries()].filter(([, v]) => !v.amount.isZero()).map(([method, v]) => ({ method, amount: v.amount, reference: v.reference ?? null }));
    return { tendered, change, rows };
  }

  async createOrder(tx: Tx, tenantId: string, userId: string, dto: PosOrderInput) {
    const session = await this.openSession(tx, dto.sessionId, 'SHARE');
    if (dto.customerId && !(await tx.contact.count({ where: { id: dto.customerId, archived: false } }))) {
      throw new BadRequestException('Customer not found');
    }
    const lines = await this.buildLines(tx, session.register, dto.lines);
    const totals = sumTotals(lines);
    const { tendered, change, rows } = this.settle(totals.total, dto.payments);
    const number = await nextNumber(tx, tenantId, 'POS');

    const order = await tx.posOrder.create({
      data: {
        tenantId,
        number,
        sessionId: session.id,
        customerId: dto.customerId ?? null,
        ...totals,
        tendered,
        change,
        createdById: userId,
        lines: { createMany: { data: lines.map(({ productType: _t, ...l }) => l) } },
        payments: { createMany: { data: rows } },
      },
      include: orderInclude,
    });

    // Goods leave the register's warehouse; one move per product.
    for (const [productId, quantity] of goodsQuantities(lines)) {
      await this.stock.apply(tx, tenantId, userId, { kind: 'DELIVERY', productId, warehouseId: session.register.warehouseId, quantity: quantity.toNumber(), reference: number });
    }
    await this.accounting.posOrder(tx, tenantId, userId, { ...order, payments: rows });
    return order;
  }

  /** Refunds a whole sale: goods go back on the shelf and the money comes out of an open session. */
  async refund(tx: Tx, tenantId: string, userId: string, id: string, sessionId: string, method?: PosMethod) {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM pos_orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (!locked.length) throw new NotFoundException();
    const original = await tx.posOrder.findUniqueOrThrow({ where: { id }, include: { lines: { include: { product: { select: { type: true } } } }, payments: true } });
    if (original.refundOfId) throw new BadRequestException('A refund cannot be refunded');
    if (original.status === 'REFUNDED') throw new BadRequestException('This sale was already refunded');
    const session = await this.openSession(tx, sessionId, 'SHARE');

    // Pay back the way the customer paid, unless the cashier picks a method.
    const payBack = method ?? (original.payments.length === 1 ? (original.payments[0].method as PosMethod) : 'CASH');
    const number = await nextNumber(tx, tenantId, 'POS');
    const refund = await tx.posOrder.create({
      data: {
        tenantId,
        number,
        sessionId: session.id,
        customerId: original.customerId,
        refundOfId: original.id,
        subtotal: original.subtotal.neg(),
        taxTotal: original.taxTotal.neg(),
        total: original.total.neg(),
        tendered: original.total.neg(),
        change: 0,
        createdById: userId,
        lines: {
          createMany: {
            data: original.lines.map((l) => ({
              position: l.position,
              productId: l.productId,
              description: l.description,
              quantity: l.quantity.neg(),
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
              taxRate: l.taxRate,
              subtotal: l.subtotal.neg(),
              taxAmount: l.taxAmount.neg(),
              total: l.total.neg(),
            })),
          },
        },
        payments: { createMany: { data: [{ method: payBack, amount: original.total.neg() }] } },
      },
      include: orderInclude,
    });
    await tx.posOrder.update({ where: { id: original.id }, data: { status: 'REFUNDED' } });

    const goods = original.lines.map((l) => ({ productId: l.productId, productType: l.product.type, quantity: l.quantity }));
    for (const [productId, quantity] of goodsQuantities(goods)) {
      await this.stock.apply(tx, tenantId, userId, { kind: 'RECEIPT', productId, warehouseId: session.register.warehouseId, quantity: quantity.toNumber(), reference: number }, { customerReturn: true });
    }
    await this.accounting.posOrder(tx, tenantId, userId, { ...refund, payments: [{ method: payBack, amount: original.total.neg() }] });
    return refund;
  }

  async close(tx: Tx, tenantId: string, user: { sub: string; role: string }, id: string, dto: CloseSessionInput) {
    const session = await this.openSession(tx, id, 'UPDATE');
    if (session.openedById !== user.sub && user.role === 'MEMBER') throw new ForbiddenException('Only the cashier who opened it, or an admin, can close this session');
    const expectedCash = await this.expectedCash(tx, id, session.openingCash);
    const countedCash = new D(dto.countedCash);
    const difference = countedCash.minus(expectedCash);
    const closed = await tx.posSession.update({
      where: { id },
      data: { status: 'CLOSED', expectedCash, countedCash, difference, closingNote: dto.note, closedById: user.sub, closedAt: new Date() },
    });
    if (!difference.isZero()) await this.accounting.posSessionClosed(tx, tenantId, user.sub, { ...closed, closedAt: closed.closedAt!, difference });
    return closed;
  }
}

/** Total quantity per stocked product (services aren't stocked). */
function goodsQuantities(lines: { productId: string; productType: string; quantity: Prisma.Decimal }[]) {
  const m = new Map<string, Prisma.Decimal>();
  for (const l of lines) if (l.productType === 'GOODS') m.set(l.productId, (m.get(l.productId) ?? ZERO).plus(l.quantity));
  return m;
}

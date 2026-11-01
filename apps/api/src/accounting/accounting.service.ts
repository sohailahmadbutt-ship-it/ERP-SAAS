import { BadRequestException, Injectable } from '@nestjs/common';
import { JournalSource, Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';
import { round2 } from '../sales/money';
import { nextNumber } from '../sales/sequences';
import { ensureAccounts, SystemKey } from './chart';

const D = Prisma.Decimal;
type Amount = Prisma.Decimal | number | string;

export interface PostingLine {
  /** A system account, or `accountId` for a specific one. */
  key?: SystemKey;
  accountId?: string;
  debit?: Amount;
  credit?: Amount;
  contactId?: string | null;
  description?: string;
}

export interface Posting {
  date: Date;
  memo?: string;
  source: JournalSource;
  sourceId?: string;
  reference?: string;
  lines: PostingLine[];
}

/** Where received stock came from, which decides the account it is valued against. */
export interface StockOrigin {
  /** A receipt against a purchase order. */
  fromPurchase?: boolean;
  /** Goods a customer returned. */
  customerReturn?: boolean;
}

/** Money received or paid by cash goes to Cash; everything else to Bank. */
export const cashKey = (method: string): SystemKey => (method === 'CASH' ? 'CASH' : 'BANK');

@Injectable()
export class AccountingService {
  /**
   * Writes a balanced journal entry inside the caller's tenant transaction.
   * Zero lines are dropped; an entry with nothing left is skipped. The
   * database re-checks the balance at commit.
   */
  async post(tx: Tx, tenantId: string, userId: string, p: Posting) {
    await ensureAccounts(tx, tenantId);
    const lines = p.lines
      .map((l) => ({ ...l, debit: round2(new D(l.debit ?? 0)), credit: round2(new D(l.credit ?? 0)) }))
      .map((l) => {
        // Net a line that has both, and flip negatives to the other side.
        const net = l.debit.minus(l.credit);
        return { ...l, debit: net.gt(0) ? net : new D(0), credit: net.lt(0) ? net.neg() : new D(0) };
      })
      .filter((l) => !l.debit.isZero() || !l.credit.isZero());
    if (!lines.length) return null;
    const dr = lines.reduce((a, l) => a.plus(l.debit), new D(0));
    const cr = lines.reduce((a, l) => a.plus(l.credit), new D(0));
    if (!dr.equals(cr)) throw new BadRequestException(`Entry does not balance: debits ${dr} vs credits ${cr}`);

    const keys = [...new Set(lines.map((l) => l.key).filter(Boolean))] as SystemKey[];
    const accounts = keys.length ? await tx.account.findMany({ where: { systemKey: { in: keys } } }) : [];
    const byKey = new Map(accounts.map((a) => [a.systemKey, a.id]));

    return tx.journalEntry.create({
      data: {
        tenantId,
        number: await nextNumber(tx, tenantId, 'JE'),
        date: p.date,
        memo: p.memo,
        source: p.source,
        sourceId: p.sourceId,
        reference: p.reference,
        createdById: userId,
        lines: {
          createMany: {
            data: lines.map((l) => {
              const accountId = l.accountId ?? byKey.get(l.key!);
              if (!accountId) throw new BadRequestException(`No account for ${l.key}`);
              return { accountId, contactId: l.contactId ?? null, description: l.description, debit: l.debit, credit: l.credit, date: p.date };
            }),
          },
        },
      },
      include: { lines: true },
    });
  }

  /** Posts the mirror image of every entry from a source (used when a document is cancelled). */
  async reverse(tx: Tx, tenantId: string, userId: string, source: JournalSource, sourceId: string, date = new Date(), memo?: string) {
    const entries = await tx.journalEntry.findMany({ where: { source, sourceId, reversesId: null }, include: { lines: true } });
    for (const e of entries) {
      if (await tx.journalEntry.count({ where: { reversesId: e.id } })) continue;
      const rev = await this.post(tx, tenantId, userId, {
        date,
        memo: memo ?? `Reversal of ${e.number}`,
        source,
        sourceId,
        reference: e.reference ?? undefined,
        lines: e.lines.map((l) => ({ accountId: l.accountId, contactId: l.contactId, description: l.description ?? undefined, debit: l.credit, credit: l.debit })),
      });
      if (rev) await tx.journalEntry.update({ where: { id: rev.id }, data: { reversesId: e.id } });
    }
  }

  // ---- Document postings --------------------------------------------------

  /** Invoice: Dr receivable / Cr sales and output tax. */
  invoicePosted(tx: Tx, tenantId: string, userId: string, inv: { id: string; number: string | null; invoiceDate: Date; customerId: string; subtotal: Prisma.Decimal; taxTotal: Prisma.Decimal; total: Prisma.Decimal }) {
    return this.post(tx, tenantId, userId, {
      date: inv.invoiceDate,
      memo: `Invoice ${inv.number}`,
      source: 'INVOICE',
      sourceId: inv.id,
      reference: inv.number ?? undefined,
      lines: [
        { key: 'RECEIVABLE', debit: inv.total, contactId: inv.customerId },
        { key: 'SALES', credit: inv.subtotal },
        { key: 'TAX_OUTPUT', credit: inv.taxTotal },
      ],
    });
  }

  /** Customer payment: Dr cash or bank / Cr receivable. */
  invoicePayment(tx: Tx, tenantId: string, userId: string, p: { id: string; amount: Prisma.Decimal; method: string; paymentDate: Date; customerId: string; reference: string | null }) {
    return this.post(tx, tenantId, userId, {
      date: p.paymentDate,
      memo: `Payment for ${p.reference}`,
      source: 'INVOICE_PAYMENT',
      sourceId: p.id,
      reference: p.reference ?? undefined,
      lines: [
        { key: cashKey(p.method), debit: p.amount },
        { key: 'RECEIVABLE', credit: p.amount, contactId: p.customerId },
      ],
    });
  }

  /**
   * Vendor bill: Cr payable for the total. Goods on a bill from a purchase
   * order clear "goods received, not yet billed" (the receipt credited it);
   * everything else is an expense. Tax goes to input tax.
   */
  billPosted(
    tx: Tx,
    tenantId: string,
    userId: string,
    bill: { id: string; number: string | null; billDate: Date; vendorId: string; orderId: string | null; taxTotal: Prisma.Decimal; total: Prisma.Decimal },
    lines: { subtotal: Prisma.Decimal; product: { type: 'GOODS' | 'SERVICE' } }[],
  ) {
    const goods = bill.orderId ? lines.filter((l) => l.product.type === 'GOODS').reduce((a, l) => a.plus(l.subtotal), new D(0)) : new D(0);
    const rest = lines.reduce((a, l) => a.plus(l.subtotal), new D(0)).minus(goods);
    return this.post(tx, tenantId, userId, {
      date: bill.billDate,
      memo: `Vendor bill ${bill.number}`,
      source: 'BILL',
      sourceId: bill.id,
      reference: bill.number ?? undefined,
      lines: [
        { key: 'GRNI', debit: goods },
        { key: 'EXPENSES', debit: rest },
        { key: 'TAX_INPUT', debit: bill.taxTotal },
        { key: 'PAYABLE', credit: bill.total, contactId: bill.vendorId },
      ],
    });
  }

  /** Paying a vendor: Dr payable / Cr cash or bank. */
  billPayment(tx: Tx, tenantId: string, userId: string, p: { id: string; amount: Prisma.Decimal; method: string; paymentDate: Date; vendorId: string; reference: string | null }) {
    return this.post(tx, tenantId, userId, {
      date: p.paymentDate,
      memo: `Payment of ${p.reference}`,
      source: 'BILL_PAYMENT',
      sourceId: p.id,
      reference: p.reference ?? undefined,
      lines: [
        { key: 'PAYABLE', debit: p.amount, contactId: p.vendorId },
        { key: cashKey(p.method), credit: p.amount },
      ],
    });
  }

  /**
   * Stock valued at cost. Receipts from a purchase order credit "goods
   * received, not yet billed"; other receipts and counts go to stock
   * adjustments; deliveries, and goods customers bring back, go to cost of
   * goods sold. Transfers don't change value, so they post nothing.
   */
  stockMoved(tx: Tx, tenantId: string, userId: string, m: { id: string; type: string; quantity: Prisma.Decimal; reference: string | null; createdAt: Date }, unitCost: Prisma.Decimal, origin: StockOrigin = {}) {
    if (m.type === 'TRANSFER_IN' || m.type === 'TRANSFER_OUT') return null;
    const value = round2(m.quantity.times(unitCost));
    const counter: SystemKey =
      m.type === 'DELIVERY' || (m.type === 'RECEIPT' && origin.customerReturn) ? 'COGS'
      : m.type === 'RECEIPT' && origin.fromPurchase ? 'GRNI'
      : 'STOCK_ADJUSTMENT';
    return this.post(tx, tenantId, userId, {
      date: m.createdAt,
      memo: `Stock ${m.type.toLowerCase()}${m.reference ? ` ${m.reference}` : ''}`,
      source: 'STOCK',
      sourceId: m.id,
      reference: m.reference ?? undefined,
      // value is signed: positive adds to inventory.
      lines: [
        { key: 'INVENTORY', debit: value },
        { key: counter, credit: value },
      ],
    });
  }

  /**
   * Point-of-sale order: Dr cash / bank per payment method, Cr sales and
   * output tax. Refunds carry negative amounts, so they post the mirror image.
   */
  posOrder(tx: Tx, tenantId: string, userId: string, o: { id: string; number: string; createdAt: Date; customerId: string | null; subtotal: Prisma.Decimal; taxTotal: Prisma.Decimal; payments: { method: string; amount: Prisma.Decimal }[] }) {
    return this.post(tx, tenantId, userId, {
      date: o.createdAt,
      memo: `Point of sale ${o.number}`,
      source: 'POS_ORDER',
      sourceId: o.id,
      reference: o.number,
      lines: [
        ...o.payments.map((p) => ({ key: cashKey(p.method), debit: p.amount, description: p.method.toLowerCase() })),
        { key: 'SALES' as const, credit: o.subtotal, contactId: o.customerId },
        { key: 'TAX_OUTPUT' as const, credit: o.taxTotal },
      ],
    });
  }

  /** Cash count at the end of a shift: any shortage or surplus goes to "cash over and short". */
  posSessionClosed(tx: Tx, tenantId: string, userId: string, s: { id: string; number: string; closedAt: Date; difference: Prisma.Decimal }) {
    return this.post(tx, tenantId, userId, {
      date: s.closedAt,
      memo: `Cash count difference, ${s.number}`,
      source: 'POS_SESSION',
      sourceId: s.id,
      reference: s.number,
      // difference > 0 is extra cash: Dr cash / Cr over-and-short.
      lines: [
        { key: 'CASH', debit: s.difference },
        { key: 'CASH_DIFFERENCE', credit: s.difference },
      ],
    });
  }
}

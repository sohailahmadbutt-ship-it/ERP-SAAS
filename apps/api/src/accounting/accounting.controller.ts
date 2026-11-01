import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Account, JournalSource, Prisma, Tenant } from '@prisma/client';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { AccountingService } from './accounting.service';
import { DEBIT_NORMAL, ensureAccounts } from './chart';
import { AccountInput, AsOfQuery, EntryQuery, LedgerQuery, ManualEntryInput, RangeQuery, UpdateAccountInput } from './dto';

const D = Prisma.Decimal;
type Req = { auth: { sub: string } };

const endOfDay = (d?: string) => (d ? new Date(d) : new Date(new Date().toISOString().slice(0, 10)));

/** Signed balance in the account's normal direction (assets/expenses: Dr − Cr; others: Cr − Dr). */
const normal = (a: Pick<Account, 'type'>, debit: Prisma.Decimal, credit: Prisma.Decimal) =>
  DEBIT_NORMAL.includes(a.type) ? debit.minus(credit) : credit.minus(debit);

async function sums(tx: Tx, where: Prisma.JournalLineWhereInput) {
  const rows = await tx.journalLine.groupBy({ by: ['accountId'], where, _sum: { debit: true, credit: true } });
  return new Map(rows.map((r) => [r.accountId, { debit: r._sum.debit ?? new D(0), credit: r._sum.credit ?? new D(0) }]));
}

@Controller()
@UseGuards(AuthGuard)
export class AccountingController {
  constructor(private prisma: PrismaService, private accounting: AccountingService) {}

  // ---- Chart of accounts ---------------------------------------------------

  @Get('accounts')
  accounts(@CurrentTenant() tenant: Tenant) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureAccounts(tx, tenant.id);
      const [accounts, totals] = await Promise.all([tx.account.findMany({ orderBy: { code: 'asc' } }), sums(tx, {})]);
      return accounts.map((a) => {
        const t = totals.get(a.id);
        return { ...a, balance: t ? normal(a, t.debit, t.credit).toString() : '0' };
      });
    });
  }

  @Post('accounts')
  @Roles('OWNER', 'ADMIN')
  async createAccount(@CurrentTenant() tenant: Tenant, @Body() dto: AccountInput) {
    try {
      return await this.prisma.withTenant(tenant.id, (tx) => tx.account.create({ data: { ...dto, tenantId: tenant.id } }));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('An account with that code already exists');
      throw e;
    }
  }

  @Patch('accounts/:id')
  @Roles('OWNER', 'ADMIN')
  async updateAccount(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountInput) {
    try {
      return await this.prisma.withTenant(tenant.id, async (tx) => {
        const acc = await tx.account.findUnique({ where: { id } });
        if (!acc) throw new NotFoundException();
        if (dto.archived && acc.systemKey) throw new BadRequestException('This account is used for automatic postings and cannot be archived');
        return tx.account.update({ where: { id }, data: dto });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('An account with that code already exists');
      throw e;
    }
  }

  // ---- Journal -------------------------------------------------------------

  @Get('journal-entries')
  entries(@CurrentTenant() tenant: Tenant, @Query() query: EntryQuery) {
    const where: Prisma.JournalEntryWhereInput = {
      source: query.source as JournalSource | undefined,
      date: query.from || query.to ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } : undefined,
      lines: query.accountId ? { some: { accountId: query.accountId } } : undefined,
    };
    if (query.q) {
      where.OR = [
        { number: { contains: query.q, mode: 'insensitive' } },
        { reference: { contains: query.q, mode: 'insensitive' } },
        { memo: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const [items, total] = await Promise.all([
        tx.journalEntry.findMany({
          where,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { lines: { include: { account: { select: { id: true, code: true, name: true } }, contact: { select: { id: true, name: true } } } } },
        }),
        tx.journalEntry.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  @Get('journal-entries/:id')
  entry(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const e = await tx.journalEntry.findUnique({
        where: { id },
        include: { lines: { include: { account: { select: { id: true, code: true, name: true } }, contact: { select: { id: true, name: true } } } } },
      });
      if (!e) throw new NotFoundException();
      return e;
    });
  }

  /** A hand-written entry, e.g. opening balances, owner's capital, bank charges. */
  @Post('journal-entries')
  @Roles('OWNER', 'ADMIN')
  manual(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Body() dto: ManualEntryInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureAccounts(tx, tenant.id);
      const ids = [...new Set(dto.lines.map((l) => l.accountId))];
      const found = await tx.account.count({ where: { id: { in: ids }, archived: false } });
      if (found !== ids.length) throw new BadRequestException('Account not found');
      for (const l of dto.lines) {
        if ((l.debit ?? 0) > 0 && (l.credit ?? 0) > 0) throw new BadRequestException('A line can have a debit or a credit, not both');
      }
      const entry = await this.accounting.post(tx, tenant.id, req.auth.sub, {
        date: new Date(dto.date),
        memo: dto.memo,
        source: 'MANUAL',
        lines: dto.lines,
      });
      if (!entry) throw new BadRequestException('Enter at least one amount');
      return entry;
    });
  }

  // ---- Reports -------------------------------------------------------------

  @Get('reports/trial-balance')
  trialBalance(@CurrentTenant() tenant: Tenant, @Query() q: AsOfQuery) {
    const asOf = endOfDay(q.asOf);
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureAccounts(tx, tenant.id);
      const [accounts, totals] = await Promise.all([tx.account.findMany({ orderBy: { code: 'asc' } }), sums(tx, { date: { lte: asOf } })]);
      const rows = accounts
        .map((a) => {
          const t = totals.get(a.id) ?? { debit: new D(0), credit: new D(0) };
          const net = t.debit.minus(t.credit);
          return { account: { id: a.id, code: a.code, name: a.name, type: a.type }, debit: net.gt(0) ? net : new D(0), credit: net.lt(0) ? net.neg() : new D(0) };
        })
        .filter((r) => !r.debit.isZero() || !r.credit.isZero());
      const debit = rows.reduce((s, r) => s.plus(r.debit), new D(0));
      const credit = rows.reduce((s, r) => s.plus(r.credit), new D(0));
      return {
        asOf: asOf.toISOString().slice(0, 10),
        rows: rows.map((r) => ({ ...r, debit: r.debit.toString(), credit: r.credit.toString() })),
        totals: { debit: debit.toString(), credit: credit.toString() },
      };
    });
  }

  @Get('reports/profit-loss')
  profitLoss(@CurrentTenant() tenant: Tenant, @Query() q: RangeQuery) {
    const to = endOfDay(q.to);
    const from = q.from ? new Date(q.from) : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureAccounts(tx, tenant.id);
      const [accounts, totals] = await Promise.all([
        tx.account.findMany({ where: { type: { in: ['INCOME', 'EXPENSE'] } }, orderBy: { code: 'asc' } }),
        sums(tx, { date: { gte: from, lte: to } }),
      ]);
      const section = (type: 'INCOME' | 'EXPENSE') => {
        const rows = accounts
          .filter((a) => a.type === type)
          .map((a) => {
            const t = totals.get(a.id);
            return { account: { id: a.id, code: a.code, name: a.name }, amount: t ? normal(a, t.debit, t.credit) : new D(0) };
          })
          .filter((r) => !r.amount.isZero());
        return { rows: rows.map((r) => ({ ...r, amount: r.amount.toString() })), total: rows.reduce((s, r) => s.plus(r.amount), new D(0)) };
      };
      const income = section('INCOME');
      const expenses = section('EXPENSE');
      return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        income: { rows: income.rows, total: income.total.toString() },
        expenses: { rows: expenses.rows, total: expenses.total.toString() },
        netProfit: income.total.minus(expenses.total).toString(),
      };
    });
  }

  @Get('reports/balance-sheet')
  balanceSheet(@CurrentTenant() tenant: Tenant, @Query() q: AsOfQuery) {
    const asOf = endOfDay(q.asOf);
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureAccounts(tx, tenant.id);
      const [accounts, totals] = await Promise.all([tx.account.findMany({ orderBy: { code: 'asc' } }), sums(tx, { date: { lte: asOf } })]);
      const bal = (a: Account) => {
        const t = totals.get(a.id);
        return t ? normal(a, t.debit, t.credit) : new D(0);
      };
      const section = (type: 'ASSET' | 'LIABILITY' | 'EQUITY') => {
        const rows = accounts.filter((a) => a.type === type).map((a) => ({ account: { id: a.id, code: a.code, name: a.name }, amount: bal(a) })).filter((r) => !r.amount.isZero());
        return { rows, total: rows.reduce((s, r) => s.plus(r.amount), new D(0)) };
      };
      // Profit not yet closed into equity: all income less all expenses to date.
      const earnings = accounts
        .filter((a) => a.type === 'INCOME' || a.type === 'EXPENSE')
        .reduce((s, a) => (a.type === 'INCOME' ? s.plus(bal(a)) : s.minus(bal(a))), new D(0));
      const assets = section('ASSET');
      const liabilities = section('LIABILITY');
      const equity = section('EQUITY');
      const fmt = (s: { rows: { account: unknown; amount: Prisma.Decimal }[]; total: Prisma.Decimal }) => ({
        rows: s.rows.map((r) => ({ ...r, amount: r.amount.toString() })),
        total: s.total.toString(),
      });
      return {
        asOf: asOf.toISOString().slice(0, 10),
        assets: fmt(assets),
        liabilities: fmt(liabilities),
        equity: { ...fmt(equity), currentEarnings: earnings.toString(), total: equity.total.plus(earnings).toString() },
        liabilitiesAndEquity: liabilities.total.plus(equity.total).plus(earnings).toString(),
      };
    });
  }

  /** Every line on one account with a running balance, starting from the balance before `from`. */
  @Get('reports/ledger')
  ledger(@CurrentTenant() tenant: Tenant, @Query() q: LedgerQuery) {
    const to = endOfDay(q.to);
    const from = q.from ? new Date(q.from) : undefined;
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const account = await tx.account.findUnique({ where: { id: q.accountId } });
      if (!account) throw new NotFoundException();
      const opening = from
        ? (await sums(tx, { accountId: account.id, date: { lt: from } })).get(account.id) ?? { debit: new D(0), credit: new D(0) }
        : { debit: new D(0), credit: new D(0) };
      let running = normal(account, opening.debit, opening.credit);
      const openingBalance = running.toString();
      const lines = await tx.journalLine.findMany({
        where: { accountId: account.id, date: { gte: from, lte: to } },
        orderBy: [{ date: 'asc' }, { entry: { createdAt: 'asc' } }],
        take: 2000,
        include: { entry: { select: { id: true, number: true, memo: true, reference: true, source: true } }, contact: { select: { id: true, name: true } } },
      });
      return {
        account,
        from: from?.toISOString().slice(0, 10) ?? null,
        to: to.toISOString().slice(0, 10),
        openingBalance,
        lines: lines.map((l) => {
          running = running.plus(normal(account, l.debit, l.credit));
          return { ...l, balance: running.toString() };
        }),
        closingBalance: running.toString(),
      };
    });
  }
}

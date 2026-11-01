import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { accessOf, addDays, ensureRenewal, issueInvoice, nextPeriodStart, paidTenantUpdate, RENEWAL_LEAD_DAYS } from '../billing/subscription';
import { PlatformGuard, type PlatformJwt } from './platform.guard';
import { InvoiceQuery, IssueInvoice, MarkPaid, PlanInput, PlatformLogin, TenantQuery, UpdatePlan, UpdateTenant } from './dto';

const userFields = { id: true, name: true, email: true, role: true, createdAt: true } as const;

/** The SaaS operator's console: every company, their subscriptions and invoices, and the plans on offer. */
@Controller('platform')
export class PlatformController {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  @Post('login')
  async login(@Body() dto: PlatformLogin) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!admin || !(await bcrypt.compare(dto.password, admin.passwordHash))) throw new UnauthorizedException('Wrong email or password');
    const payload: PlatformJwt = { sub: admin.id, scope: 'platform' };
    return { token: this.jwt.sign(payload, { expiresIn: '8h' }), admin: { id: admin.id, name: admin.name, email: admin.email } };
  }

  @Get('me')
  @UseGuards(PlatformGuard)
  async me(@Req() req: { platform: PlatformJwt }) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: req.platform.sub }, select: { id: true, name: true, email: true } });
    if (!admin) throw new UnauthorizedException();
    return admin;
  }

  @Get('stats')
  @UseGuards(PlatformGuard)
  stats() {
    return this.prisma.asPlatform(async (tx) => {
      const tenants = await tx.tenant.findMany({ include: { planRef: true } });
      const now = new Date();
      const byState: Record<string, number> = {};
      let mrr = new Prisma.Decimal(0);
      for (const t of tenants) {
        const { state } = accessOf(t, now);
        byState[state] = (byState[state] ?? 0) + 1;
        if (state === 'active' || state === 'past_due') mrr = mrr.add(t.planRef.priceMonthly);
      }
      const open = await tx.platformInvoice.aggregate({ where: { status: 'OPEN' }, _count: true, _sum: { amount: true } });
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const paid = await tx.platformInvoice.aggregate({ where: { status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amount: true } });
      const trialsEndingSoon = tenants.filter((t) => accessOf(t, now).state === 'trial' && t.trialEndsAt && t.trialEndsAt <= addDays(now, 3)).length;
      return {
        companies: tenants.length,
        byState,
        trialsEndingSoon,
        mrr,
        openInvoices: open._count,
        openAmount: open._sum.amount ?? 0,
        paidThisMonth: paid._sum.amount ?? 0,
      };
    });
  }

  @Get('tenants')
  @UseGuards(PlatformGuard)
  tenants(@Query() q: TenantQuery) {
    return this.prisma.asPlatform(async (tx) => {
      const rows = await tx.tenant.findMany({
        where: {
          ...(q.status ? { status: q.status as never } : {}),
          ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
        },
        include: { planRef: true, _count: { select: { users: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map(({ _count, ...t }) => ({ ...t, userCount: _count.users, ...accessOf(t) }));
    });
  }

  @Get('tenants/:id')
  @UseGuards(PlatformGuard)
  async tenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.asPlatform(async (tx) => {
      const t = await tx.tenant.findUnique({
        where: { id },
        include: { planRef: true, users: { select: userFields, orderBy: { createdAt: 'asc' } }, platformInvoices: { orderBy: { createdAt: 'desc' } } },
      });
      if (!t) throw new NotFoundException();
      return { ...t, ...accessOf(t) };
    });
  }

  @Patch('tenants/:id')
  @UseGuards(PlatformGuard)
  async updateTenant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenant) {
    return this.prisma.asPlatform(async (tx) => {
      if (dto.plan && !(await tx.plan.findUnique({ where: { code: dto.plan } }))) throw new BadRequestException('Unknown plan');
      try {
        const t = await tx.tenant.update({
          where: { id },
          data: {
            plan: dto.plan,
            status: dto.status,
            trialEndsAt: dto.trialEndsAt ? new Date(dto.trialEndsAt) : undefined,
            currentPeriodEnd: dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : undefined,
            statusNote: dto.statusNote,
          },
          include: { planRef: true },
        });
        return { ...t, ...accessOf(t) };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException();
        throw e;
      }
    });
  }

  @Get('invoices')
  @UseGuards(PlatformGuard)
  invoices(@Query() q: InvoiceQuery) {
    return this.prisma.asPlatform((tx) =>
      tx.platformInvoice.findMany({
        where: { status: q.status, tenantId: q.tenantId },
        include: { tenant: { select: { id: true, name: true, slug: true } } },
        // Payments the company has reported come first, so they get confirmed quickly.
        orderBy: [{ reportedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 200,
      }),
    );
  }

  /** Issues an invoice for a company (its current plan unless another is given), replacing any open one. */
  @Post('invoices')
  @UseGuards(PlatformGuard)
  issue(@Body() dto: IssueInvoice) {
    return this.prisma.asPlatform(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM tenants WHERE id = ${dto.tenantId}::uuid FOR UPDATE`;
      const t = await tx.tenant.findUnique({ where: { id: dto.tenantId } });
      if (!t) throw new NotFoundException('Unknown company');
      const plan = await tx.plan.findUnique({ where: { code: dto.planCode ?? t.plan } });
      if (!plan) throw new BadRequestException('Unknown plan');
      await tx.platformInvoice.updateMany({ where: { tenantId: t.id, status: 'OPEN' }, data: { status: 'VOID' } });
      return issueInvoice(tx, t, plan, nextPeriodStart(t));
    });
  }

  /** Issues next month's invoice for every active company whose paid period ends within a week. */
  @Post('invoices/renewals')
  @UseGuards(PlatformGuard)
  renewals() {
    return this.prisma.asPlatform(async (tx) => {
      const due = await tx.tenant.findMany({
        where: { status: 'ACTIVE', currentPeriodEnd: { lte: addDays(new Date(), RENEWAL_LEAD_DAYS) } },
        include: { planRef: true },
      });
      const issued = [];
      for (const t of due) {
        const inv = await ensureRenewal(tx, t);
        if (inv) issued.push(inv);
      }
      return { issued: issued.length, invoices: issued };
    });
  }

  @Post('invoices/:id/mark-paid')
  @UseGuards(PlatformGuard)
  markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkPaid) {
    return this.prisma.asPlatform(async (tx) => {
      const [locked] = await tx.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM platform_invoices WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException();
      await tx.$executeRaw`SELECT 1 FROM tenants WHERE id = ${locked.tenant_id}::uuid FOR UPDATE`;
      const inv = await tx.platformInvoice.findUniqueOrThrow({ where: { id }, include: { tenant: true } });
      if (inv.status !== 'OPEN') throw new BadRequestException('Only open invoices can be marked paid');
      const paid = await tx.platformInvoice.update({
        where: { id },
        data: { status: 'PAID', paidAt: new Date(), paymentReference: dto.reference ?? inv.paymentReference },
      });
      const tenant = await tx.tenant.update({ where: { id: inv.tenantId }, data: paidTenantUpdate(inv.tenant, inv), include: { planRef: true } });
      return { invoice: paid, tenant: { ...tenant, ...accessOf(tenant) } };
    });
  }

  @Post('invoices/:id/void')
  @UseGuards(PlatformGuard)
  void(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.asPlatform(async (tx) => {
      const { count } = await tx.platformInvoice.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'VOID' } });
      if (!count) throw new BadRequestException('Only open invoices can be voided');
      return tx.platformInvoice.findUniqueOrThrow({ where: { id } });
    });
  }

  @Get('plans')
  @UseGuards(PlatformGuard)
  plans() {
    return this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { tenants: true } } } });
  }

  @Post('plans')
  @UseGuards(PlatformGuard)
  async createPlan(@Body() dto: PlanInput) {
    try {
      return await this.prisma.plan.create({ data: { ...dto, currency: dto.currency?.toUpperCase() } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A plan with that code exists');
      throw e;
    }
  }

  @Patch('plans/:id')
  @UseGuards(PlatformGuard)
  async updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlan) {
    try {
      return await this.prisma.plan.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException();
      throw e;
    }
  }
}

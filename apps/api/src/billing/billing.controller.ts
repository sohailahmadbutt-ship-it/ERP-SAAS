import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AllowInactive, AuthGuard, Roles } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { accessOf, ensureRenewal, issueInvoice, nextPeriodStart, userLimitError } from './subscription';

export class PlanChoice {
  @IsString() @MaxLength(40) planCode: string;
}

export class PaymentReport {
  @IsString() @MinLength(3) @MaxLength(200) reference: string;
}

/**
 * The signed-in company's own subscription. Payment is offline for now (bank
 * transfer or mobile wallet): the owner reports a reference and the platform
 * marks the invoice paid from the console.
 */
@Controller('billing')
@UseGuards(AuthGuard)
@AllowInactive()
export class BillingController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async overview(@CurrentTenant() tenant: Tenant) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, include: { planRef: true } });
      await ensureRenewal(tx, t);
      const [plans, userCount, invoices] = await Promise.all([
        tx.plan.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
        tx.user.count(),
        tx.platformInvoice.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      ]);
      return {
        plan: t.planRef,
        status: t.status,
        statusNote: t.statusNote,
        trialEndsAt: t.trialEndsAt,
        currentPeriodEnd: t.currentPeriodEnd,
        ...accessOf(t),
        userCount,
        plans,
        invoices,
        paymentInstructions: process.env.PAYMENT_INSTRUCTIONS ?? 'Pay by bank transfer to the account shown on your invoice, then enter the transfer reference here.',
      };
    });
  }

  /** During the trial, switch plans freely. */
  @Patch('plan')
  @Roles('OWNER')
  async changeTrialPlan(@CurrentTenant() tenant: Tenant, @Body() dto: PlanChoice) {
    if (accessOf(tenant).state !== 'trial') throw new BadRequestException('Outside the trial, choose a plan through checkout');
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const plan = await tx.plan.findFirst({ where: { code: dto.planCode, active: true } });
      if (!plan) throw new BadRequestException('Unknown plan');
      const err = userLimitError(plan, await tx.user.count());
      if (err) throw new BadRequestException(err);
      return tx.tenant.update({ where: { id: tenant.id }, data: { plan: plan.code } });
    });
  }

  /**
   * Issues an invoice for a month of the chosen plan, replacing any other open
   * invoice. The plan takes effect once the invoice is paid.
   */
  @Post('checkout')
  @Roles('OWNER')
  async checkout(@CurrentTenant() tenant: Tenant, @Body() dto: PlanChoice) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM tenants WHERE id = ${tenant.id}::uuid FOR UPDATE`;
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
      const plan = await tx.plan.findFirst({ where: { code: dto.planCode, active: true } });
      if (!plan) throw new BadRequestException('Unknown plan');
      const err = userLimitError(plan, await tx.user.count());
      if (err) throw new BadRequestException(err);
      await tx.platformInvoice.updateMany({ where: { status: 'OPEN' }, data: { status: 'VOID' } });
      return issueInvoice(tx, t, plan, nextPeriodStart(t));
    });
  }

  @Post('invoices/:id/payment')
  @Roles('OWNER', 'ADMIN')
  async reportPayment(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentReport) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const inv = await tx.platformInvoice.findUnique({ where: { id } });
      if (!inv) throw new NotFoundException();
      if (inv.status !== 'OPEN') throw new BadRequestException('This invoice is not open');
      return tx.platformInvoice.update({ where: { id }, data: { paymentReference: dto.reference, reportedAt: new Date() } });
    });
  }
}

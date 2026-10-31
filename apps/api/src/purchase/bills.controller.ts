import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { BillStatus, Prisma, Tenant } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { buildLines, lockRow } from '../sales/lines';
import { sumTotals } from '../sales/money';
import { nextNumber } from '../sales/sequences';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { BillInput, DocQuery, PaymentInput, UpdateBillInput } from './dto';
import { checkContact } from './purchase-orders.controller';

type Req = { auth: { sub: string } };

const billInclude = {
  vendor: { select: { id: true, name: true, email: true, phone: true, address: true, city: true, country: true, taxId: true } },
  order: { select: { id: true, number: true } },
  lines: { orderBy: { position: 'asc' }, include: { product: { select: { id: true, name: true, sku: true, unit: { select: { code: true } } } } } },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BillInclude;

/** Vendor bills: draft → posted (numbered) → paid. */
@Controller('bills')
@UseGuards(AuthGuard)
export class BillsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant, @Query() query: DocQuery) {
    const where: Prisma.BillWhereInput = { vendorId: query.customerId };
    if (query.status) {
      if (!Object.values(BillStatus).includes(query.status as BillStatus)) throw new BadRequestException('Unknown status');
      where.status = query.status as BillStatus;
    }
    if (query.q) {
      where.OR = [
        { number: { contains: query.q, mode: 'insensitive' } },
        { vendorRef: { contains: query.q, mode: 'insensitive' } },
        { vendor: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const [items, total] = await Promise.all([
        tx.bill.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { vendor: { select: { id: true, name: true } }, order: { select: { id: true, number: true } } },
        }),
        tx.bill.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  @Get(':id')
  get(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id }, include: billInclude });
      if (!bill) throw new NotFoundException();
      return bill;
    });
  }

  /** A bill not tied to a purchase order (rent, utilities, services…). */
  @Post()
  create(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Body() dto: BillInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await checkContact(tx, dto.vendorId, 'Vendor');
      const lines = await buildLines(tx, tenant.id, dto.lines, 'cost');
      const bill = await tx.bill.create({
        data: {
          tenantId: tenant.id,
          vendorId: dto.vendorId,
          vendorRef: dto.vendorRef,
          billDate: dto.billDate ? new Date(dto.billDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          notes: dto.notes,
          currency: tenant.currency,
          createdById: req.auth.sub,
          ...sumTotals(lines),
          lines: { createMany: { data: lines.map(({ tenantId: _t, ...l }) => l) } },
        },
      });
      return tx.bill.findUniqueOrThrow({ where: { id: bill.id }, include: billInclude });
    });
  }

  @Patch(':id')
  update(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBillInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const bill = await this.load(tx, id);
      if (bill.status !== 'DRAFT') throw new BadRequestException('Only draft bills can be edited');
      if (bill.orderId && (dto.lines || dto.vendorId)) {
        throw new BadRequestException('This bill comes from a purchase order; change the order instead');
      }
      if (dto.vendorId) await checkContact(tx, dto.vendorId, 'Vendor');
      const data: Prisma.BillUncheckedUpdateInput = {
        vendorId: dto.vendorId,
        vendorRef: dto.vendorRef,
        billDate: dto.billDate ? new Date(dto.billDate) : undefined,
        dueDate: dto.dueDate === undefined ? undefined : dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes,
      };
      if (dto.lines) {
        const lines = await buildLines(tx, tenant.id, dto.lines, 'cost');
        await tx.billLine.deleteMany({ where: { billId: id } });
        await tx.billLine.createMany({ data: lines.map((l) => ({ ...l, billId: id })) });
        Object.assign(data, sumTotals(lines));
      }
      await tx.bill.update({ where: { id }, data });
      return tx.bill.findUniqueOrThrow({ where: { id }, include: billInclude });
    });
  }

  @Post(':id/post')
  post(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const bill = await this.load(tx, id);
      if (bill.status !== 'DRAFT') throw new BadRequestException('Only draft bills can be posted');
      if ((await tx.billLine.count({ where: { billId: id } })) === 0) throw new BadRequestException('Add at least one line first');
      await tx.bill.update({
        where: { id },
        data: { status: bill.total.isZero() ? 'PAID' : 'POSTED', number: await nextNumber(tx, tenant.id, 'BILL'), postedAt: new Date() },
      });
      return tx.bill.findUniqueOrThrow({ where: { id }, include: billInclude });
    });
  }

  @Post(':id/cancel')
  cancel(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const bill = await this.load(tx, id);
      if (bill.status === 'CANCELLED') throw new BadRequestException('Already cancelled');
      if (bill.amountPaid.gt(0)) throw new BadRequestException('This bill has payments, so it cannot be cancelled');
      if (bill.orderId) await lockRow(tx, 'purchase_orders', bill.orderId);
      const lines = await tx.billLine.findMany({ where: { billId: id, orderLineId: { not: null } } });
      for (const l of lines) {
        await tx.purchaseOrderLine.update({ where: { id: l.orderLineId! }, data: { billedQty: { decrement: l.quantity } } });
      }
      await tx.bill.update({ where: { id }, data: { status: 'CANCELLED' } });
      return tx.bill.findUniqueOrThrow({ where: { id }, include: billInclude });
    });
  }

  @Post(':id/payments')
  pay(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const bill = await this.load(tx, id);
      if (bill.status !== 'POSTED') throw new BadRequestException(bill.status === 'PAID' ? 'This bill is already paid' : 'Post the bill before recording payments');
      const balance = bill.total.minus(bill.amountPaid);
      const amount = new Prisma.Decimal(dto.amount);
      if (amount.gt(balance)) throw new BadRequestException(`The balance due is ${balance.toFixed(2)}`);
      await tx.billPayment.create({
        data: {
          tenantId: tenant.id,
          billId: id,
          amount,
          method: dto.method,
          reference: dto.reference,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
          createdById: req.auth.sub,
        },
      });
      const amountPaid = bill.amountPaid.plus(amount);
      await tx.bill.update({ where: { id }, data: { amountPaid, status: amountPaid.equals(bill.total) ? 'PAID' : 'POSTED' } });
      return tx.bill.findUniqueOrThrow({ where: { id }, include: billInclude });
    });
  }

  private async load(tx: Tx, id: string) {
    if (!(await lockRow(tx, 'bills', id))) throw new NotFoundException();
    return tx.bill.findUniqueOrThrow({ where: { id } });
  }
}

import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InvoiceStatus, Prisma, Tenant } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { DocQuery, InvoiceInput, PaymentInput, UpdateInvoiceInput } from './dto';
import { buildLines, lockRow } from './lines';
import { sumTotals } from './money';
import { nextNumber } from './sequences';

type Req = { auth: { sub: string } };

const invoiceInclude = {
  customer: { select: { id: true, name: true, email: true, phone: true, address: true, city: true, country: true, taxId: true } },
  order: { select: { id: true, number: true } },
  lines: { orderBy: { position: 'asc' }, include: { product: { select: { id: true, name: true, sku: true, unit: { select: { code: true } } } } } },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.InvoiceInclude;

/** Customer invoices: draft → posted (numbered) → paid. */
@Controller('invoices')
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant, @Query() query: DocQuery) {
    const where: Prisma.InvoiceWhereInput = { customerId: query.customerId };
    if (query.status) {
      if (!Object.values(InvoiceStatus).includes(query.status as InvoiceStatus)) throw new BadRequestException('Unknown status');
      where.status = query.status as InvoiceStatus;
    }
    if (query.q) {
      where.OR = [
        { number: { contains: query.q, mode: 'insensitive' } },
        { customer: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const [items, total] = await Promise.all([
        tx.invoice.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { customer: { select: { id: true, name: true } }, order: { select: { id: true, number: true } } },
        }),
        tx.invoice.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  @Get(':id')
  get(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id }, include: invoiceInclude });
      if (!inv) throw new NotFoundException();
      return inv;
    });
  }

  /** A standalone invoice, not tied to a sales order. */
  @Post()
  create(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Body() dto: InvoiceInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await this.checkCustomer(tx, dto.customerId);
      const lines = await buildLines(tx, tenant.id, dto.lines);
      const inv = await tx.invoice.create({
        data: {
          tenantId: tenant.id,
          customerId: dto.customerId,
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          notes: dto.notes,
          currency: tenant.currency,
          createdById: req.auth.sub,
          ...sumTotals(lines),
          lines: { createMany: { data: lines.map(({ tenantId: _t, ...l }) => l) } },
        },
      });
      return tx.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: invoiceInclude });
    });
  }

  /** Drafts only. Lines of an invoice made from an order follow the order, so they can't be edited here. */
  @Patch(':id')
  update(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const inv = await this.load(tx, id);
      if (inv.status !== 'DRAFT') throw new BadRequestException('Only draft invoices can be edited');
      if (inv.orderId && (dto.lines || dto.customerId)) {
        throw new BadRequestException('This invoice comes from a sales order; change the order instead');
      }
      if (dto.customerId) await this.checkCustomer(tx, dto.customerId);
      const data: Prisma.InvoiceUncheckedUpdateInput = {
        customerId: dto.customerId,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
        dueDate: dto.dueDate === undefined ? undefined : dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes,
      };
      if (dto.lines) {
        const lines = await buildLines(tx, tenant.id, dto.lines);
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceLine.createMany({ data: lines.map((l) => ({ ...l, invoiceId: id })) });
        Object.assign(data, sumTotals(lines));
      }
      await tx.invoice.update({ where: { id }, data });
      return tx.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
    });
  }

  /** Finalises a draft and gives it the next invoice number. */
  @Post(':id/post')
  post(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const inv = await this.load(tx, id);
      if (inv.status !== 'DRAFT') throw new BadRequestException('Only draft invoices can be posted');
      if ((await tx.invoiceLine.count({ where: { invoiceId: id } })) === 0) throw new BadRequestException('Add at least one line first');
      await tx.invoice.update({
        where: { id },
        data: { status: inv.total.isZero() ? 'PAID' : 'POSTED', number: await nextNumber(tx, tenant.id, 'INV'), postedAt: new Date() },
      });
      return tx.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
    });
  }

  /** Cancels a draft or an unpaid posted invoice and frees its order lines to be invoiced again. */
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const inv = await this.load(tx, id);
      if (inv.status === 'CANCELLED') throw new BadRequestException('Already cancelled');
      if (inv.amountPaid.gt(0)) throw new BadRequestException('This invoice has payments, so it cannot be cancelled');
      if (inv.orderId) await lockRow(tx, 'sales_orders', inv.orderId);
      const lines = await tx.invoiceLine.findMany({ where: { invoiceId: id, orderLineId: { not: null } } });
      for (const l of lines) {
        await tx.salesOrderLine.update({ where: { id: l.orderLineId! }, data: { invoicedQty: { decrement: l.quantity } } });
      }
      await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
      return tx.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
    });
  }

  @Post(':id/payments')
  pay(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const inv = await this.load(tx, id);
      if (inv.status !== 'POSTED') throw new BadRequestException(inv.status === 'PAID' ? 'This invoice is already paid' : 'Post the invoice before recording payments');
      const balance = inv.total.minus(inv.amountPaid);
      const amount = new Prisma.Decimal(dto.amount);
      if (amount.gt(balance)) throw new BadRequestException(`The balance due is ${balance.toFixed(2)}`);
      await tx.payment.create({
        data: {
          tenantId: tenant.id,
          invoiceId: id,
          amount,
          method: dto.method,
          reference: dto.reference,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
          createdById: req.auth.sub,
        },
      });
      const amountPaid = inv.amountPaid.plus(amount);
      await tx.invoice.update({ where: { id }, data: { amountPaid, status: amountPaid.equals(inv.total) ? 'PAID' : 'POSTED' } });
      return tx.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
    });
  }

  private async load(tx: Tx, id: string) {
    if (!(await lockRow(tx, 'invoices', id))) throw new NotFoundException();
    return tx.invoice.findUniqueOrThrow({ where: { id } });
  }

  private async checkCustomer(tx: Tx, id: string) {
    const c = await tx.contact.findUnique({ where: { id }, select: { archived: true } });
    if (!c || c.archived) throw new BadRequestException('Customer not found');
  }
}

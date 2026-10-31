import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SalesOrderStatus, Prisma, Tenant } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { StockService } from '../inventory/stock.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { DeliverInput, DocQuery, OrderInput, UpdateOrderInput } from './dto';
import { buildLines, lockRow } from './lines';
import { lineAmounts, sumTotals } from './money';
import { nextNumber } from './sequences';

type Req = { auth: { sub: string } };
const D = Prisma.Decimal;

const orderInclude = {
  customer: { select: { id: true, name: true, email: true, phone: true, address: true, city: true, country: true, taxId: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  lines: { orderBy: { position: 'asc' }, include: { product: { select: { id: true, name: true, sku: true, type: true, unit: { select: { code: true } } } } } },
  invoices: { orderBy: { createdAt: 'asc' }, select: { id: true, number: true, status: true, total: true, amountPaid: true } },
} satisfies Prisma.SalesOrderInclude;

/** Quotations and sales orders: quote → confirm → deliver → invoice. */
@Controller('sales-orders')
@UseGuards(AuthGuard)
export class SalesOrdersController {
  constructor(private prisma: PrismaService, private stock: StockService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant, @Query() query: DocQuery) {
    const where: Prisma.SalesOrderWhereInput = { customerId: query.customerId };
    if (query.status) {
      if (!Object.values(SalesOrderStatus).includes(query.status as SalesOrderStatus)) throw new BadRequestException('Unknown status');
      where.status = query.status as SalesOrderStatus;
    }
    if (query.q) {
      where.OR = [
        { number: { contains: query.q, mode: 'insensitive' } },
        { customer: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const [items, total] = await Promise.all([
        tx.salesOrder.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { customer: { select: { id: true, name: true } } },
        }),
        tx.salesOrder.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  @Get(':id')
  get(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await tx.salesOrder.findUnique({ where: { id }, include: orderInclude });
      if (!order) throw new NotFoundException();
      return order;
    });
  }

  @Post()
  create(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Body() dto: OrderInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await this.checkCustomer(tx, dto.customerId);
      const warehouseId = await this.pickWarehouse(tx, dto.warehouseId);
      const lines = await buildLines(tx, tenant.id, dto.lines);
      const order = await tx.salesOrder.create({
        data: {
          tenantId: tenant.id,
          number: await nextNumber(tx, tenant.id, 'SO'),
          customerId: dto.customerId,
          warehouseId,
          orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          notes: dto.notes,
          currency: tenant.currency,
          createdById: req.auth.sub,
          ...sumTotals(lines),
          lines: { createMany: { data: lines.map(({ tenantId: _t, ...l }) => l) } },
        },
      });
      return tx.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    });
  }

  /** Quotations are fully editable; sending `lines` replaces them all. */
  @Patch(':id')
  update(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await this.load(tx, id);
      if (order.status !== 'QUOTATION') throw new BadRequestException('Only quotations can be edited');
      if (dto.customerId) await this.checkCustomer(tx, dto.customerId);
      const data: Prisma.SalesOrderUncheckedUpdateInput = {
        customerId: dto.customerId,
        warehouseId: dto.warehouseId ? await this.pickWarehouse(tx, dto.warehouseId) : undefined,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
        validUntil: dto.validUntil === undefined ? undefined : dto.validUntil ? new Date(dto.validUntil) : null,
        notes: dto.notes,
      };
      if (dto.lines) {
        const lines = await buildLines(tx, tenant.id, dto.lines);
        await tx.salesOrderLine.deleteMany({ where: { orderId: id } });
        await tx.salesOrderLine.createMany({ data: lines.map((l) => ({ ...l, orderId: id })) });
        Object.assign(data, sumTotals(lines));
      }
      await tx.salesOrder.update({ where: { id }, data });
      return tx.salesOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
  }

  @Post(':id/confirm')
  confirm(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await this.load(tx, id);
      if (order.status !== 'QUOTATION') throw new BadRequestException('Only quotations can be confirmed');
      if ((await tx.salesOrderLine.count({ where: { orderId: id } })) === 0) throw new BadRequestException('Add at least one line first');
      await tx.salesOrder.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
      // Selling to a contact makes them a customer.
      await tx.contact.update({ where: { id: order.customerId }, data: { isCustomer: true } });
      return tx.salesOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
  }

  @Post(':id/cancel')
  cancel(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await this.load(tx, id);
      if (order.status === 'CANCELLED') throw new BadRequestException('Already cancelled');
      const delivered = await tx.salesOrderLine.count({ where: { orderId: id, deliveredQty: { gt: 0 } } });
      const invoiced = await tx.invoice.count({ where: { orderId: id, status: { not: 'CANCELLED' } } });
      if (delivered || invoiced) throw new BadRequestException('This order has deliveries or invoices, so it cannot be cancelled');
      await tx.salesOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
      return tx.salesOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
  }

  /**
   * Ships goods from the order's warehouse (creating stock moves) and marks
   * service lines as done. Without `lines`, delivers everything outstanding.
   */
  @Post(':id/deliver')
  deliver(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await this.load(tx, id);
      if (order.status !== 'CONFIRMED') throw new BadRequestException('Confirm the order before delivering');
      const lines = await tx.salesOrderLine.findMany({ where: { orderId: id }, include: { product: true } });
      const wanted = new Map<string, Prisma.Decimal>();
      if (dto.lines?.length) {
        for (const l of dto.lines) {
          const line = lines.find((x) => x.id === l.lineId);
          if (!line) throw new BadRequestException('Line not found on this order');
          wanted.set(l.lineId, (wanted.get(l.lineId) ?? new D(0)).plus(l.quantity));
        }
      } else {
        for (const l of lines) wanted.set(l.id, l.quantity.minus(l.deliveredQty));
      }
      let changed = false;
      for (const line of lines) {
        const qty = wanted.get(line.id);
        if (!qty || qty.lte(0)) continue;
        const remaining = line.quantity.minus(line.deliveredQty);
        if (qty.gt(remaining)) throw new BadRequestException(`${line.description}: only ${remaining} left to deliver`);
        if (line.product.type === 'GOODS') {
          await this.stock.apply(tx, tenant.id, req.auth.sub, {
            kind: 'DELIVERY',
            productId: line.productId,
            warehouseId: order.warehouseId,
            quantity: qty.toNumber(),
            reference: order.number,
          });
        }
        await tx.salesOrderLine.update({ where: { id: line.id }, data: { deliveredQty: line.deliveredQty.plus(qty) } });
        changed = true;
      }
      if (!changed) throw new BadRequestException('Nothing left to deliver');
      return tx.salesOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
  }

  /** Creates a draft invoice for everything ordered but not yet invoiced. */
  @Post(':id/invoice')
  invoice(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await this.load(tx, id);
      if (order.status !== 'CONFIRMED') throw new BadRequestException('Confirm the order before invoicing');
      const lines = await tx.salesOrderLine.findMany({ where: { orderId: id }, orderBy: { position: 'asc' } });
      const toInvoice = lines
        .map((l) => ({ line: l, qty: l.quantity.minus(l.invoicedQty) }))
        .filter((x) => x.qty.gt(0));
      if (!toInvoice.length) throw new BadRequestException('Everything on this order is already invoiced');

      const invLines = toInvoice.map(({ line, qty }, i) => ({
        tenantId: tenant.id,
        position: i + 1,
        productId: line.productId,
        orderLineId: line.id,
        description: line.description,
        quantity: qty,
        unitPrice: line.unitPrice,
        discountPct: line.discountPct,
        taxId: line.taxId,
        taxRate: line.taxRate,
        ...lineAmounts(qty, line.unitPrice, line.discountPct, line.taxRate),
      }));
      const invoice = await tx.invoice.create({
        data: {
          tenantId: tenant.id,
          customerId: order.customerId,
          orderId: order.id,
          currency: order.currency,
          createdById: req.auth.sub,
          ...sumTotals(invLines),
          lines: { createMany: { data: invLines.map(({ tenantId: _t, ...l }) => l) } },
        },
      });
      for (const { line, qty } of toInvoice) {
        await tx.salesOrderLine.update({ where: { id: line.id }, data: { invoicedQty: line.invoicedQty.plus(qty) } });
      }
      return invoice;
    });
  }

  private async load(tx: Tx, id: string) {
    if (!(await lockRow(tx, 'sales_orders', id))) throw new NotFoundException();
    return tx.salesOrder.findUniqueOrThrow({ where: { id } });
  }

  private async checkCustomer(tx: Tx, id: string) {
    const c = await tx.contact.findUnique({ where: { id }, select: { archived: true } });
    if (!c || c.archived) throw new BadRequestException('Customer not found');
  }

  private async pickWarehouse(tx: Tx, id?: string) {
    const wh = await tx.warehouse.findFirst({ where: { id, archived: false }, orderBy: { code: 'asc' } });
    if (!wh) throw new BadRequestException('Warehouse not found');
    return wh.id;
  }
}

import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma, PurchaseOrderStatus, Tenant } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { StockService } from '../inventory/stock.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { buildLines, lockRow } from '../sales/lines';
import { lineAmounts, round2, sumTotals } from '../sales/money';
import { nextNumber } from '../sales/sequences';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { DocQuery, PurchaseOrderInput, ReceiveInput, UpdatePurchaseOrderInput } from './dto';

type Req = { auth: { sub: string } };
const D = Prisma.Decimal;

const orderInclude = {
  vendor: { select: { id: true, name: true, email: true, phone: true, address: true, city: true, country: true, taxId: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  lines: { orderBy: { position: 'asc' }, include: { product: { select: { id: true, name: true, sku: true, type: true, unit: { select: { code: true } } } } } },
  bills: { orderBy: { createdAt: 'asc' }, select: { id: true, number: true, status: true, total: true, amountPaid: true } },
} satisfies Prisma.PurchaseOrderInclude;

/** Requests for quotation and purchase orders: RFQ → confirm → receive → bill. */
@Controller('purchase-orders')
@UseGuards(AuthGuard)
export class PurchaseOrdersController {
  constructor(private prisma: PrismaService, private stock: StockService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant, @Query() query: DocQuery) {
    const where: Prisma.PurchaseOrderWhereInput = { vendorId: query.customerId };
    if (query.status) {
      if (!Object.values(PurchaseOrderStatus).includes(query.status as PurchaseOrderStatus)) throw new BadRequestException('Unknown status');
      where.status = query.status as PurchaseOrderStatus;
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
        tx.purchaseOrder.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { vendor: { select: { id: true, name: true } } },
        }),
        tx.purchaseOrder.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  @Get(':id')
  get(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await tx.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
      if (!order) throw new NotFoundException();
      return order;
    });
  }

  @Post()
  create(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Body() dto: PurchaseOrderInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await checkContact(tx, dto.vendorId, 'Vendor');
      const warehouseId = await this.pickWarehouse(tx, dto.warehouseId);
      const lines = await buildLines(tx, tenant.id, dto.lines, 'cost');
      const order = await tx.purchaseOrder.create({
        data: {
          tenantId: tenant.id,
          number: await nextNumber(tx, tenant.id, 'PO'),
          vendorId: dto.vendorId,
          warehouseId,
          orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          vendorRef: dto.vendorRef,
          notes: dto.notes,
          currency: tenant.currency,
          createdById: req.auth.sub,
          ...sumTotals(lines),
          lines: { createMany: { data: lines.map(({ tenantId: _t, ...l }) => l) } },
        },
      });
      return tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    });
  }

  /** RFQs are fully editable; sending `lines` replaces them all. */
  @Patch(':id')
  update(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePurchaseOrderInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await this.load(tx, id);
      if (order.status !== 'RFQ') throw new BadRequestException('Only requests for quotation can be edited');
      if (dto.vendorId) await checkContact(tx, dto.vendorId, 'Vendor');
      const data: Prisma.PurchaseOrderUncheckedUpdateInput = {
        vendorId: dto.vendorId,
        warehouseId: dto.warehouseId ? await this.pickWarehouse(tx, dto.warehouseId) : undefined,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
        expectedDate: dto.expectedDate === undefined ? undefined : dto.expectedDate ? new Date(dto.expectedDate) : null,
        vendorRef: dto.vendorRef,
        notes: dto.notes,
      };
      if (dto.lines) {
        const lines = await buildLines(tx, tenant.id, dto.lines, 'cost');
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
        await tx.purchaseOrderLine.createMany({ data: lines.map((l) => ({ ...l, orderId: id })) });
        Object.assign(data, sumTotals(lines));
      }
      await tx.purchaseOrder.update({ where: { id }, data });
      return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
  }

  @Post(':id/confirm')
  confirm(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await this.load(tx, id);
      if (order.status !== 'RFQ') throw new BadRequestException('Only requests for quotation can be confirmed');
      if ((await tx.purchaseOrderLine.count({ where: { orderId: id } })) === 0) throw new BadRequestException('Add at least one line first');
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
      // Buying from a contact makes them a vendor.
      await tx.contact.update({ where: { id: order.vendorId }, data: { isVendor: true } });
      return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
  }

  @Post(':id/cancel')
  cancel(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await this.load(tx, id);
      if (order.status === 'CANCELLED') throw new BadRequestException('Already cancelled');
      const received = await tx.purchaseOrderLine.count({ where: { orderId: id, receivedQty: { gt: 0 } } });
      const billed = await tx.bill.count({ where: { orderId: id, status: { not: 'CANCELLED' } } });
      if (received || billed) throw new BadRequestException('This order has receipts or bills, so it cannot be cancelled');
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
      return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
  }

  /**
   * Receives goods into the order's warehouse (creating stock moves and
   * updating average cost) and marks service lines as done. Without
   * `lines`, receives everything outstanding.
   */
  @Post(':id/receive')
  receive(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await this.load(tx, id);
      if (order.status !== 'CONFIRMED') throw new BadRequestException('Confirm the order before receiving');
      const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: id }, include: { product: true } });
      const wanted = new Map<string, Prisma.Decimal>();
      if (dto.lines?.length) {
        for (const l of dto.lines) {
          if (!lines.some((x) => x.id === l.lineId)) throw new BadRequestException('Line not found on this order');
          wanted.set(l.lineId, (wanted.get(l.lineId) ?? new D(0)).plus(l.quantity));
        }
      } else {
        for (const l of lines) wanted.set(l.id, l.quantity.minus(l.receivedQty));
      }
      let changed = false;
      for (const line of lines) {
        const qty = wanted.get(line.id);
        if (!qty || qty.lte(0)) continue;
        const remaining = line.quantity.minus(line.receivedQty);
        if (qty.gt(remaining)) throw new BadRequestException(`${line.description}: only ${remaining} left to receive`);
        if (line.product.type === 'GOODS') {
          await this.stock.apply(tx, tenant.id, req.auth.sub, {
            kind: 'RECEIPT',
            productId: line.productId,
            warehouseId: order.warehouseId,
            quantity: qty.toNumber(),
            // Net of discount, before tax.
            unitCost: round2(line.subtotal.div(line.quantity)).toNumber(),
            reference: order.number,
          }, { fromPurchase: true });
        }
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty.plus(qty) } });
        changed = true;
      }
      if (!changed) throw new BadRequestException('Nothing left to receive');
      return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
  }

  /** Creates a draft vendor bill for everything ordered but not yet billed. */
  @Post(':id/bill')
  bill(@CurrentTenant() tenant: Tenant, @Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const order = await this.load(tx, id);
      if (order.status !== 'CONFIRMED') throw new BadRequestException('Confirm the order before billing');
      const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: id }, orderBy: { position: 'asc' } });
      const toBill = lines.map((l) => ({ line: l, qty: l.quantity.minus(l.billedQty) })).filter((x) => x.qty.gt(0));
      if (!toBill.length) throw new BadRequestException('Everything on this order is already billed');
      const billLines = toBill.map(({ line, qty }, i) => ({
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
      const bill = await tx.bill.create({
        data: {
          tenantId: tenant.id,
          vendorId: order.vendorId,
          orderId: order.id,
          vendorRef: order.vendorRef,
          currency: order.currency,
          createdById: req.auth.sub,
          ...sumTotals(billLines),
          lines: { createMany: { data: billLines.map(({ tenantId: _t, ...l }) => l) } },
        },
      });
      for (const { line, qty } of toBill) {
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { billedQty: line.billedQty.plus(qty) } });
      }
      return bill;
    });
  }

  private async load(tx: Tx, id: string) {
    if (!(await lockRow(tx, 'purchase_orders', id))) throw new NotFoundException();
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
  }

  private async pickWarehouse(tx: Tx, id?: string) {
    const wh = await tx.warehouse.findFirst({ where: { id, archived: false }, orderBy: { code: 'asc' } });
    if (!wh) throw new BadRequestException('Warehouse not found');
    return wh.id;
  }
}

export async function checkContact(tx: Tx, id: string, label: string) {
  const c = await tx.contact.findUnique({ where: { id }, select: { archived: true } });
  if (!c || c.archived) throw new BadRequestException(`${label} not found`);
}

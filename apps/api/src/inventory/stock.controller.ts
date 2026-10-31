import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Prisma, Tenant } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { LevelQuery, MoveQuery, StockMoveInput } from './dto';
import { StockService } from './stock.service';

@Controller('stock')
@UseGuards(AuthGuard)
export class StockController {
  constructor(private prisma: PrismaService, private stock: StockService) {}

  /** Records a receipt, delivery, transfer or count. Returns the moves created. */
  @Post('moves')
  move(@CurrentTenant() tenant: Tenant, @Req() req: { auth: { sub: string } }, @Body() dto: StockMoveInput) {
    return this.prisma.withTenant(tenant.id, (tx) => this.stock.apply(tx, tenant.id, req.auth.sub, dto));
  }

  @Get('moves')
  moves(@CurrentTenant() tenant: Tenant, @Query() query: MoveQuery) {
    const where: Prisma.StockMoveWhereInput = { productId: query.productId, warehouseId: query.warehouseId };
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const [items, total] = await Promise.all([
        tx.stockMove.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            product: { select: { id: true, name: true, sku: true } },
            warehouse: { select: { id: true, code: true } },
          },
        }),
        tx.stockMove.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  /** On-hand quantity per product and warehouse, leaving out zero rows. */
  @Get('levels')
  levels(@CurrentTenant() tenant: Tenant, @Query() query: LevelQuery) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const sums = await tx.stockMove.groupBy({
        by: ['productId', 'warehouseId'],
        where: {
          warehouseId: query.warehouseId,
          product: query.q
            ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { sku: { contains: query.q, mode: 'insensitive' } }] }
            : undefined,
        },
        _sum: { quantity: true },
      });
      const rows = sums.filter((s) => s._sum.quantity && !s._sum.quantity.isZero());
      const [products, warehouses] = await Promise.all([
        tx.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, include: { unit: { select: { code: true } } } }),
        tx.warehouse.findMany({ where: { id: { in: rows.map((r) => r.warehouseId) } } }),
      ]);
      const p = new Map(products.map((x) => [x.id, x]));
      const w = new Map(warehouses.map((x) => [x.id, x]));
      return rows
        .map((r) => {
          const prod = p.get(r.productId)!;
          const wh = w.get(r.warehouseId)!;
          return {
            product: { id: prod.id, name: prod.name, sku: prod.sku, unit: prod.unit.code },
            warehouse: { id: wh.id, code: wh.code, name: wh.name },
            quantity: r._sum.quantity!.toString(),
          };
        })
        .sort((a, b) => a.product.name.localeCompare(b.product.name) || a.warehouse.code.localeCompare(b.warehouse.code));
    });
  }
}

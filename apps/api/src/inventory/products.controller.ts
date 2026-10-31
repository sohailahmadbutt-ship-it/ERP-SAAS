import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { ProductInput, ProductQuery, UpdateProductInput } from './dto';

/** Maps the errors Postgres raises for bad links and duplicate SKUs to 4xx. */
function friendly(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') throw new ConflictException('A product with that SKU already exists');
    // Composite (id, tenant_id) foreign key: unknown unit or one from another company.
    if (e.code === 'P2003') throw new BadRequestException('Unit not found');
  }
  throw e;
}

@Controller('products')
@UseGuards(AuthGuard)
export class ProductsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant, @Query() query: ProductQuery) {
    const where: Prisma.ProductWhereInput = { archived: query.archived ?? false, type: query.type };
    if (query.q) {
      const contains = query.q;
      where.OR = [
        { name: { contains, mode: 'insensitive' } },
        { sku: { contains, mode: 'insensitive' } },
        { barcode: { equals: contains } },
      ];
    }
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const [items, total] = await Promise.all([
        tx.product.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { unit: { select: { code: true } } },
        }),
        tx.product.count({ where }),
      ]);
      const sums = await tx.stockMove.groupBy({
        by: ['productId'],
        where: { productId: { in: items.map((p) => p.id) } },
        _sum: { quantity: true },
      });
      const onHand = new Map(sums.map((s) => [s.productId, s._sum.quantity?.toString() ?? '0']));
      return {
        items: items.map((p) => ({ ...p, onHand: p.type === 'GOODS' ? onHand.get(p.id) ?? '0' : null })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  @Get(':id')
  get(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const product = await tx.product.findUnique({ where: { id }, include: { unit: true } });
      if (!product) throw new NotFoundException();
      const [sums, warehouses] = await Promise.all([
        tx.stockMove.groupBy({ by: ['warehouseId'], where: { productId: id }, _sum: { quantity: true } }),
        tx.warehouse.findMany({ orderBy: { code: 'asc' } }),
      ]);
      const byWh = new Map(sums.map((s) => [s.warehouseId, s._sum.quantity?.toString() ?? '0']));
      const stock = warehouses
        .map((w) => ({ warehouse: { id: w.id, code: w.code, name: w.name }, quantity: byWh.get(w.id) ?? '0' }))
        .filter((s) => s.quantity !== '0' || !warehouses.find((w) => w.id === s.warehouse.id)?.archived);
      return { ...product, stock };
    });
  }

  @Post()
  async create(@CurrentTenant() tenant: Tenant, @Body() dto: ProductInput) {
    try {
      return await this.prisma.withTenant(tenant.id, (tx) => tx.product.create({ data: { ...dto, sku: dto.sku || null, tenantId: tenant.id } }));
    } catch (e) {
      friendly(e);
    }
  }

  @Patch(':id')
  async update(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductInput) {
    try {
      return await this.prisma.withTenant(tenant.id, async (tx) => {
        const current = await tx.product.findUnique({ where: { id }, select: { type: true } });
        if (!current) throw new NotFoundException();
        if (dto.type && dto.type !== current.type && (await tx.stockMove.count({ where: { productId: id } })) > 0) {
          throw new BadRequestException('This product has stock history, so its type cannot change');
        }
        return tx.product.update({ where: { id }, data: { ...dto, sku: dto.sku === '' ? null : dto.sku } });
      });
    } catch (e) {
      friendly(e);
    }
  }

  /** Archives rather than deletes, so stock history and documents keep their product. */
  @Delete(':id')
  async archive(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.withTenant(tenant.id, (tx) => tx.product.updateMany({ where: { id }, data: { archived: true } }));
    if (!count) throw new NotFoundException();
    return { ok: true };
  }
}

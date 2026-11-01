import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma, type Tenant } from '@prisma/client';
import { AuthGuard, Roles } from '../auth/auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { CatalogQuery, CloseSessionInput, OpenSessionInput, OrderQuery, PosOrderInput, RefundInput, RegisterInput, SessionQuery, UpdateRegisterInput } from './dto';
import { orderInclude, PosService } from './pos.service';
import { nextNumber } from '../sales/sequences';

type AuthedRequest = { auth: JwtPayload };
const PAGE = 50;

@Controller('pos')
@UseGuards(AuthGuard)
export class PosController {
  constructor(private prisma: PrismaService, private pos: PosService) {}

  // ---- Registers -----------------------------------------------------------

  /** Lists registers. A company's first visit gets a "Main register" on its first warehouse. */
  @Get('registers')
  registers(@CurrentTenant() tenant: Tenant) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      if ((await tx.posRegister.count()) === 0) {
        const warehouse = await tx.warehouse.findFirst({ where: { archived: false }, orderBy: { createdAt: 'asc' } });
        const tax = await tx.tax.findFirst({ where: { archived: false }, orderBy: { name: 'asc' } });
        if (warehouse) await tx.posRegister.create({ data: { tenantId: tenant.id, name: 'Main register', warehouseId: warehouse.id, taxId: tax?.id } });
      }
      return tx.posRegister.findMany({
        orderBy: [{ archived: 'asc' }, { name: 'asc' }],
        include: { warehouse: { select: { id: true, code: true, name: true } }, tax: true, sessions: { where: { status: 'OPEN' }, select: { id: true, number: true, openedById: true, openedAt: true } } },
      });
    });
  }

  @Post('registers')
  @Roles('OWNER', 'ADMIN')
  createRegister(@CurrentTenant() tenant: Tenant, @Body() dto: RegisterInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await checkRefs(tx, dto);
      return tx.posRegister.create({ data: { ...dto, tenantId: tenant.id } });
    });
  }

  @Patch('registers/:id')
  @Roles('OWNER', 'ADMIN')
  updateRegister(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRegisterInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      if (!(await tx.posRegister.count({ where: { id } }))) throw new NotFoundException();
      await checkRefs(tx, dto);
      if (dto.archived && (await tx.posSession.count({ where: { registerId: id, status: 'OPEN' } }))) {
        throw new BadRequestException('Close the open session before archiving this register');
      }
      return tx.posRegister.update({ where: { id }, data: dto });
    });
  }

  // ---- Sessions ------------------------------------------------------------

  @Get('sessions')
  sessions(@CurrentTenant() tenant: Tenant, @Query() q: SessionQuery) {
    return this.prisma.withTenant(tenant.id, (tx) =>
      tx.posSession.findMany({
        where: { registerId: q.registerId, status: q.status },
        orderBy: { openedAt: 'desc' },
        take: 100,
        include: { register: { select: { id: true, name: true } } },
      }),
    );
  }

  @Post('sessions')
  open(@CurrentTenant() tenant: Tenant, @Req() req: AuthedRequest, @Body() dto: OpenSessionInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const register = await tx.posRegister.findUnique({ where: { id: dto.registerId } });
      if (!register || register.archived) throw new BadRequestException('Register not found');
      try {
        return await tx.posSession.create({
          data: { tenantId: tenant.id, number: await nextNumber(tx, tenant.id, 'SHIFT'), registerId: register.id, openingCash: dto.openingCash, openedById: req.auth.sub },
        });
      } catch (e) {
        // The partial unique index allows one open session per register.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('This register already has an open session');
        throw e;
      }
    });
  }

  @Get('sessions/:id')
  session(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, (tx) => this.pos.summary(tx, id));
  }

  @Post('sessions/:id/close')
  close(@CurrentTenant() tenant: Tenant, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseSessionInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await this.pos.close(tx, tenant.id, req.auth, id, dto);
      return this.pos.summary(tx, id);
    });
  }

  /** Products for the till, with what's on hand in the register's warehouse. */
  @Get('sessions/:id/products')
  catalog(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Query() q: CatalogQuery) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const session = await tx.posSession.findUnique({ where: { id }, include: { register: true } });
      if (!session) throw new NotFoundException();
      const term = q.q?.trim();
      const products = await tx.product.findMany({
        where: {
          archived: false,
          ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { sku: { contains: term, mode: 'insensitive' } }, { barcode: term }] } : {}),
        },
        orderBy: { name: 'asc' },
        take: 60,
        select: { id: true, name: true, sku: true, barcode: true, type: true, salePrice: true, unit: { select: { code: true } } },
      });
      const stock = await tx.stockMove.groupBy({
        by: ['productId'],
        where: { warehouseId: session.register.warehouseId, productId: { in: products.map((p) => p.id) } },
        _sum: { quantity: true },
      });
      const onHand = new Map(stock.map((s) => [s.productId, s._sum.quantity]));
      return products.map((p) => ({ ...p, onHand: p.type === 'GOODS' ? onHand.get(p.id) ?? '0' : null }));
    });
  }

  // ---- Orders --------------------------------------------------------------

  @Post('orders')
  createOrder(@CurrentTenant() tenant: Tenant, @Req() req: AuthedRequest, @Body() dto: PosOrderInput) {
    return this.prisma.withTenant(tenant.id, (tx) => this.pos.createOrder(tx, tenant.id, req.auth.sub, dto));
  }

  @Get('orders')
  orders(@CurrentTenant() tenant: Tenant, @Query() q: OrderQuery) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const where: Prisma.PosOrderWhereInput = {
        sessionId: q.sessionId,
        ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
      };
      const [items, total] = await Promise.all([
        tx.posOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * PAGE, take: PAGE, include: { customer: { select: { id: true, name: true } }, payments: true } }),
        tx.posOrder.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: PAGE };
    });
  }

  @Get('orders/:id')
  async order(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    const order = await this.prisma.withTenant(tenant.id, (tx) => tx.posOrder.findUnique({ where: { id }, include: orderInclude }));
    if (!order) throw new NotFoundException();
    return order;
  }

  @Post('orders/:id/refund')
  @Roles('OWNER', 'ADMIN')
  refund(@CurrentTenant() tenant: Tenant, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundInput) {
    return this.prisma.withTenant(tenant.id, (tx) => this.pos.refund(tx, tenant.id, req.auth.sub, id, dto.sessionId, dto.method));
  }
}

async function checkRefs(tx: Tx, dto: { warehouseId?: string; taxId?: string | null }) {
  if (dto.warehouseId && !(await tx.warehouse.count({ where: { id: dto.warehouseId, archived: false } }))) throw new BadRequestException('Warehouse not found');
  if (dto.taxId && !(await tx.tax.count({ where: { id: dto.taxId, archived: false } }))) throw new BadRequestException('Tax not found');
}

import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { ensureInventoryDefaults } from './defaults';
import { UpdateWarehouseInput, WarehouseInput } from './dto';

@Controller('warehouses')
@UseGuards(AuthGuard)
export class WarehousesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureInventoryDefaults(tx, tenant.id);
      return tx.warehouse.findMany({ orderBy: [{ archived: 'asc' }, { code: 'asc' }] });
    });
  }

  @Post()
  async create(@CurrentTenant() tenant: Tenant, @Body() dto: WarehouseInput) {
    try {
      return await this.prisma.withTenant(tenant.id, (tx) =>
        tx.warehouse.create({ data: { ...dto, code: dto.code.toUpperCase(), tenantId: tenant.id } }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A warehouse with that code already exists');
      throw e;
    }
  }

  @Patch(':id')
  async update(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarehouseInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const { count } = await tx.warehouse.updateMany({ where: { id }, data: dto });
      if (!count) throw new NotFoundException();
      return tx.warehouse.findUniqueOrThrow({ where: { id } });
    });
  }
}

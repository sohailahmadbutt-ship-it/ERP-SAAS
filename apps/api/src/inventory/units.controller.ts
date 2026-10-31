import { Body, ConflictException, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { ensureInventoryDefaults } from './defaults';
import { UnitInput } from './dto';

@Controller('units')
@UseGuards(AuthGuard)
export class UnitsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureInventoryDefaults(tx, tenant.id);
      return tx.unit.findMany({ orderBy: { name: 'asc' } });
    });
  }

  @Post()
  async create(@CurrentTenant() tenant: Tenant, @Body() dto: UnitInput) {
    try {
      return await this.prisma.withTenant(tenant.id, (tx) => tx.unit.create({ data: { ...dto, code: dto.code.toLowerCase(), tenantId: tenant.id } }));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A unit with that code already exists');
      throw e;
    }
  }
}

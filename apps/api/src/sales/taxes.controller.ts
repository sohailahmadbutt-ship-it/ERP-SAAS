import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { ensureSalesDefaults } from './defaults';
import { TaxInput, UpdateTaxInput } from './dto';

@Controller('taxes')
@UseGuards(AuthGuard)
export class TaxesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureSalesDefaults(tx, tenant.id);
      return tx.tax.findMany({ orderBy: [{ archived: 'asc' }, { rate: 'desc' }] });
    });
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  create(@CurrentTenant() tenant: Tenant, @Body() dto: TaxInput) {
    return this.prisma.withTenant(tenant.id, (tx) => tx.tax.create({ data: { ...dto, tenantId: tenant.id } }));
  }

  /** Changing a rate affects new lines only; existing documents keep the rate they were made with. */
  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  update(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaxInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const { count } = await tx.tax.updateMany({ where: { id }, data: { ...dto, archived: dto.archived === undefined ? undefined : !!dto.archived } });
      if (!count) throw new NotFoundException();
      return tx.tax.findUniqueOrThrow({ where: { id } });
    });
  }
}

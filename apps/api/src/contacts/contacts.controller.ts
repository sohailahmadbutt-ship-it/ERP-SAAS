import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { Prisma, Tenant } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { ContactInput, ContactQuery, UpdateContactInput } from './dto';

@Controller('contacts')
@UseGuards(AuthGuard)
export class ContactsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant, @Query() query: ContactQuery) {
    const where: Prisma.ContactWhereInput = { archived: query.archived ?? false };
    if (query.role === 'customer') where.isCustomer = true;
    if (query.role === 'vendor') where.isVendor = true;
    if (query.q) {
      const contains = query.q;
      where.OR = [
        { name: { contains, mode: 'insensitive' } },
        { email: { contains, mode: 'insensitive' } },
        { phone: { contains } },
        { taxId: { contains, mode: 'insensitive' } },
      ];
    }
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const [items, total] = await Promise.all([
        tx.contact.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { parent: { select: { id: true, name: true } } },
        }),
        tx.contact.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  @Get(':id')
  async get(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    const contact = await this.prisma.withTenant(tenant.id, (tx) =>
      tx.contact.findUnique({
        where: { id },
        include: { parent: { select: { id: true, name: true } }, children: { where: { archived: false }, orderBy: { name: 'asc' } } },
      }),
    );
    if (!contact) throw new NotFoundException();
    return contact;
  }

  @Post()
  create(@CurrentTenant() tenant: Tenant, @Body() dto: ContactInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await this.checkParent(tx, dto.kind ?? 'COMPANY', dto.parentId);
      return tx.contact.create({ data: { ...this.clean(dto), name: dto.name, tenantId: tenant.id } });
    });
  }

  @Patch(':id')
  update(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const current = await tx.contact.findUnique({ where: { id }, select: { kind: true, parentId: true, _count: { select: { children: true } } } });
      if (!current) throw new NotFoundException();
      const kind = dto.kind ?? current.kind;
      if (kind === 'PERSON' && current._count.children > 0) {
        throw new BadRequestException('This company has people linked to it, so it cannot become a person');
      }
      await this.checkParent(tx, kind, dto.parentId === undefined ? current.parentId : dto.parentId);
      return tx.contact.update({ where: { id }, data: { ...this.clean(dto), archived: dto.archived } });
    });
  }

  /** Archives rather than deletes, so documents that reference the contact keep working. */
  @Delete(':id')
  async archive(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.withTenant(tenant.id, (tx) => tx.contact.updateMany({ where: { id }, data: { archived: true } }));
    if (!count) throw new NotFoundException();
    return { ok: true };
  }

  /**
   * Foreign keys are checked by Postgres without row-level security, so a
   * parent id from another company would otherwise be accepted. Look it up
   * through the tenant-scoped transaction instead.
   */
  private async checkParent(tx: Tx, kind: 'COMPANY' | 'PERSON', parentId: string | null | undefined) {
    if (!parentId) return;
    // Only people sit under a company, which also rules out cycles.
    if (kind !== 'PERSON') throw new BadRequestException('Only a person can belong to a company');
    const parent = await tx.contact.findUnique({ where: { id: parentId }, select: { kind: true } });
    if (!parent) throw new BadRequestException('Parent contact not found');
    if (parent.kind !== 'COMPANY') throw new BadRequestException('Parent contact must be a company');
  }

  private clean(dto: ContactInput | UpdateContactInput) {
    return {
      kind: dto.kind,
      name: dto.name,
      parentId: dto.parentId,
      email: dto.email?.toLowerCase() ?? dto.email,
      phone: dto.phone,
      address: dto.address,
      city: dto.city,
      country: dto.country?.toUpperCase() ?? dto.country,
      taxId: dto.taxId,
      isCustomer: dto.isCustomer,
      isVendor: dto.isVendor,
      creditLimit: dto.creditLimit,
      notes: dto.notes,
    };
  }
}

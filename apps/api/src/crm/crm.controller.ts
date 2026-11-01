import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma, type CrmStage, type Tenant } from '@prisma/client';
import { AuthGuard, Roles } from '../auth/auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { nextNumber } from '../sales/sequences';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { ActivityInput, ActivityQuery, LeadInput, LeadQuery, LostInput, StageInput, UpdateActivityInput, UpdateLeadInput, UpdateStageInput } from './dto';
import { ensureCrmStages } from './defaults';

type AuthedRequest = { auth: JwtPayload };
const D = Prisma.Decimal;

const leadInclude = {
  stage: true,
  contact: { select: { id: true, name: true, email: true, phone: true } },
  salesOrder: { select: { id: true, number: true, status: true, total: true } },
  activities: { orderBy: [{ doneAt: { sort: 'desc', nulls: 'first' } }, { dueAt: 'asc' }, { createdAt: 'desc' }] },
} satisfies Prisma.CrmLeadInclude;

const isClosed = (s: Pick<CrmStage, 'isWon' | 'isLost'>) => s.isWon || s.isLost;

@Controller('crm')
@UseGuards(AuthGuard)
export class CrmController {
  constructor(private prisma: PrismaService) {}

  // ---- Stages --------------------------------------------------------------

  @Get('stages')
  stages(@CurrentTenant() tenant: Tenant) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureCrmStages(tx, tenant.id);
      return tx.crmStage.findMany({ orderBy: { position: 'asc' } });
    });
  }

  @Post('stages')
  @Roles('OWNER', 'ADMIN')
  createStage(@CurrentTenant() tenant: Tenant, @Body() dto: StageInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureCrmStages(tx, tenant.id);
      // New stages go before the closing (won/lost) stages unless placed explicitly.
      const firstClosed = await tx.crmStage.findFirst({ where: { OR: [{ isWon: true }, { isLost: true }] }, orderBy: { position: 'asc' } });
      const position = dto.position ?? firstClosed?.position ?? (await tx.crmStage.count()) + 1;
      await tx.crmStage.updateMany({ where: { position: { gte: position } }, data: { position: { increment: 1 } } });
      return tx.crmStage.create({ data: { tenantId: tenant.id, name: dto.name, probability: dto.probability, position } });
    });
  }

  @Patch('stages/:id')
  @Roles('OWNER', 'ADMIN')
  updateStage(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStageInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const stage = await tx.crmStage.findUnique({ where: { id } });
      if (!stage) throw new NotFoundException();
      if (dto.archived) {
        if (isClosed(stage)) throw new BadRequestException('The won and lost stages are needed to close leads');
        if (await tx.crmLead.count({ where: { stageId: id, archived: false } })) throw new BadRequestException('Move the leads out of this stage first');
      }
      return tx.crmStage.update({ where: { id }, data: dto });
    });
  }

  // ---- Leads ---------------------------------------------------------------

  @Get('leads')
  leads(@CurrentTenant() tenant: Tenant, @Query() q: LeadQuery) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const status = q.status ?? 'open';
      const term = q.q?.trim();
      return tx.crmLead.findMany({
        where: {
          archived: q.archived ?? false,
          ownerId: q.ownerId,
          contactId: q.contactId,
          ...(status === 'open' ? { stage: { isWon: false, isLost: false } } : status === 'won' ? { stage: { isWon: true } } : status === 'lost' ? { stage: { isLost: true } } : {}),
          ...(term
            ? { OR: ['title', 'companyName', 'personName', 'email', 'phone'].map((f) => ({ [f]: { contains: term, mode: 'insensitive' } })).concat([{ contact: { name: { contains: term, mode: 'insensitive' } } } as never]) }
            : {}),
        },
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        take: 500,
        include: {
          contact: { select: { id: true, name: true } },
          // The next thing to do on each lead, for the board.
          activities: { where: { doneAt: null }, orderBy: { dueAt: { sort: 'asc', nulls: 'last' } }, take: 1 },
        },
      });
    });
  }

  @Get('leads/:id')
  async lead(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    const lead = await this.prisma.withTenant(tenant.id, (tx) => tx.crmLead.findUnique({ where: { id }, include: leadInclude }));
    if (!lead) throw new NotFoundException();
    return lead;
  }

  @Post('leads')
  createLead(@CurrentTenant() tenant: Tenant, @Req() req: AuthedRequest, @Body() dto: LeadInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureCrmStages(tx, tenant.id);
      const stage = dto.stageId
        ? await tx.crmStage.findFirst({ where: { id: dto.stageId, archived: false } })
        : await tx.crmStage.findFirst({ where: { archived: false, isWon: false, isLost: false }, orderBy: { position: 'asc' } });
      if (!stage) throw new BadRequestException('Stage not found');
      await checkRefs(tx, dto);
      const lead = await tx.crmLead.create({
        data: {
          ...leadData(dto),
          title: dto.title,
          tenantId: tenant.id,
          stageId: stage.id,
          ownerId: dto.ownerId === undefined ? req.auth.sub : dto.ownerId,
          closedAt: isClosed(stage) ? new Date() : null,
          createdById: req.auth.sub,
        },
      });
      return tx.crmLead.findUniqueOrThrow({ where: { id: lead.id }, include: leadInclude });
    });
  }

  /** Edits a lead. Moving it into a won or lost stage closes it; moving it back reopens it. */
  @Patch('leads/:id')
  updateLead(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const lead = await tx.crmLead.findUnique({ where: { id }, include: { stage: true } });
      if (!lead) throw new NotFoundException();
      await checkRefs(tx, dto);
      const data: Prisma.CrmLeadUncheckedUpdateInput = { ...leadData(dto), title: dto.title, archived: dto.archived };
      if (dto.stageId && dto.stageId !== lead.stageId) {
        const stage = await tx.crmStage.findFirst({ where: { id: dto.stageId, archived: false } });
        if (!stage) throw new BadRequestException('Stage not found');
        Object.assign(data, moveTo(stage, lead.stage));
      }
      await tx.crmLead.update({ where: { id }, data });
      return tx.crmLead.findUniqueOrThrow({ where: { id }, include: leadInclude });
    });
  }

  @Post('leads/:id/won')
  won(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.close(tenant, id, { isWon: true }, {});
  }

  @Post('leads/:id/lost')
  lost(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LostInput) {
    return this.close(tenant, id, { isLost: true }, { lostReason: dto.reason ?? null });
  }

  private close(tenant: Tenant, id: string, where: Prisma.CrmStageWhereInput, extra: Prisma.CrmLeadUncheckedUpdateInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureCrmStages(tx, tenant.id);
      const lead = await tx.crmLead.findUnique({ where: { id }, include: { stage: true } });
      if (!lead) throw new NotFoundException();
      const stage = await tx.crmStage.findFirst({ where: { ...where, archived: false }, orderBy: { position: 'asc' } });
      if (!stage) throw new BadRequestException('No stage to move the lead to');
      await tx.crmLead.update({ where: { id }, data: { ...moveTo(stage, lead.stage), ...extra } });
      return tx.crmLead.findUniqueOrThrow({ where: { id }, include: leadInclude });
    });
  }

  /**
   * Turns a lead into a draft quotation. A prospect without a contact becomes
   * a customer contact first.
   */
  @Post('leads/:id/quotation')
  quotation(@CurrentTenant() tenant: Tenant, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await tx.$executeRaw`SELECT id FROM crm_leads WHERE id = ${id}::uuid FOR UPDATE`;
      const lead = await tx.crmLead.findUnique({ where: { id } });
      if (!lead) throw new NotFoundException();
      if (lead.salesOrderId) throw new BadRequestException('This lead already has a quotation');
      let customerId = lead.contactId;
      if (!customerId) {
        const name = lead.companyName || lead.personName;
        if (!name) throw new BadRequestException('Add a company or person name, or link a contact, first');
        const contact = await tx.contact.create({
          data: { tenantId: tenant.id, kind: lead.companyName ? 'COMPANY' : 'PERSON', name, email: lead.email, phone: lead.phone, isCustomer: true, notes: lead.personName && lead.companyName ? `Contact person: ${lead.personName}` : null },
        });
        customerId = contact.id;
      } else {
        await tx.contact.update({ where: { id: customerId }, data: { isCustomer: true } });
      }
      const warehouse = await tx.warehouse.findFirst({ where: { archived: false }, orderBy: { code: 'asc' } });
      if (!warehouse) throw new BadRequestException('Add a warehouse first');
      const order = await tx.salesOrder.create({
        data: {
          tenantId: tenant.id,
          number: await nextNumber(tx, tenant.id, 'SO'),
          customerId,
          warehouseId: warehouse.id,
          currency: tenant.currency,
          notes: lead.title,
          createdById: req.auth.sub,
        },
      });
      await tx.crmLead.update({ where: { id }, data: { contactId: customerId, salesOrderId: order.id } });
      return tx.crmLead.findUniqueOrThrow({ where: { id }, include: leadInclude });
    });
  }

  // ---- Activities ----------------------------------------------------------

  @Post('leads/:id/activities')
  addActivity(@CurrentTenant() tenant: Tenant, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActivityInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      if (!(await tx.crmLead.count({ where: { id } }))) throw new NotFoundException();
      await checkUser(tx, dto.assignedToId);
      const activity = await tx.crmActivity.create({
        data: {
          tenantId: tenant.id,
          leadId: id,
          type: dto.type,
          summary: dto.summary,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          // A note records something that already happened.
          doneAt: dto.type === 'NOTE' ? new Date() : null,
          assignedToId: dto.assignedToId === undefined ? req.auth.sub : dto.assignedToId,
          createdById: req.auth.sub,
        },
      });
      await tx.crmLead.update({ where: { id }, data: { updatedAt: new Date() } });
      return activity;
    });
  }

  @Patch('activities/:id')
  updateActivity(@CurrentTenant() tenant: Tenant, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateActivityInput) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      const a = await tx.crmActivity.findUnique({ where: { id } });
      if (!a) throw new NotFoundException();
      await checkUser(tx, dto.assignedToId);
      return tx.crmActivity.update({
        where: { id },
        data: {
          summary: dto.summary,
          dueAt: dto.dueAt === undefined ? undefined : dto.dueAt ? new Date(dto.dueAt) : null,
          assignedToId: dto.assignedToId,
          doneAt: dto.done === undefined ? undefined : dto.done ? (a.doneAt ?? new Date()) : null,
        },
      });
    });
  }

  /** Activities across leads: a salesperson's to-do list. */
  @Get('activities')
  activities(@CurrentTenant() tenant: Tenant, @Req() req: AuthedRequest, @Query() q: ActivityQuery) {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay.getTime() + 86400000);
    const when: Record<string, Prisma.CrmActivityWhereInput> = {
      overdue: { doneAt: null, dueAt: { lt: startOfDay } },
      today: { doneAt: null, dueAt: { gte: startOfDay, lt: endOfDay } },
      upcoming: { doneAt: null, OR: [{ dueAt: { gte: endOfDay } }, { dueAt: null }] },
      open: { doneAt: null },
      done: { doneAt: { not: null } },
    };
    return this.prisma.withTenant(tenant.id, (tx) =>
      tx.crmActivity.findMany({
        where: { ...(q.mine ? { assignedToId: req.auth.sub } : {}), ...when[q.when ?? 'open'], lead: { archived: false } },
        orderBy: q.when === 'done' ? { doneAt: 'desc' } : { dueAt: { sort: 'asc', nulls: 'last' } },
        take: 200,
        include: { lead: { select: { id: true, title: true, companyName: true, contact: { select: { name: true } } } } },
      }),
    );
  }

  // ---- Summary ---------------------------------------------------------------

  /** Pipeline value per stage (raw and weighted by probability) and this month's results. */
  @Get('summary')
  summary(@CurrentTenant() tenant: Tenant) {
    return this.prisma.withTenant(tenant.id, async (tx) => {
      await ensureCrmStages(tx, tenant.id);
      const stages = await tx.crmStage.findMany({ where: { archived: false }, orderBy: { position: 'asc' } });
      const sums = await tx.crmLead.groupBy({ by: ['stageId'], where: { archived: false }, _count: true, _sum: { expectedRevenue: true } });
      const byStage = new Map(sums.map((s) => [s.stageId, s]));
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const closedThisMonth = (flag: 'isWon' | 'isLost') =>
        tx.crmLead.aggregate({ where: { archived: false, closedAt: { gte: monthStart }, stage: { [flag]: true } }, _count: true, _sum: { expectedRevenue: true } });
      const [won, lost] = await Promise.all([closedThisMonth('isWon'), closedThisMonth('isLost')]);
      const rows = stages.map((s) => {
        const sum = byStage.get(s.id);
        const value = sum?._sum.expectedRevenue ?? new D(0);
        return { stage: s, count: sum?._count ?? 0, value, weighted: value.times(s.probability).div(100).toDecimalPlaces(2) };
      });
      const open = rows.filter((r) => !isClosed(r.stage));
      return {
        stages: rows,
        open: { count: open.reduce((a, r) => a + r.count, 0), value: open.reduce((a, r) => a.plus(r.value), new D(0)), weighted: open.reduce((a, r) => a.plus(r.weighted), new D(0)) },
        wonThisMonth: { count: won._count, value: won._sum.expectedRevenue ?? 0 },
        lostThisMonth: { count: lost._count, value: lost._sum.expectedRevenue ?? 0 },
      };
    });
  }
}

/** Fields shared by create and update, with dates parsed. Undefined leaves a field as it is. */
function leadData(dto: LeadInput) {
  return {
    contactId: dto.contactId,
    companyName: dto.companyName,
    personName: dto.personName,
    email: dto.email,
    phone: dto.phone,
    source: dto.source,
    ownerId: dto.ownerId,
    expectedRevenue: dto.expectedRevenue,
    expectedClose: dto.expectedClose === undefined ? undefined : dto.expectedClose ? new Date(dto.expectedClose) : null,
    priority: dto.priority,
    notes: dto.notes,
  };
}

/** The closing fields when a lead moves to `to` from `from`. */
function moveTo(to: CrmStage, from: CrmStage): Prisma.CrmLeadUncheckedUpdateInput {
  if (isClosed(to)) return { stageId: to.id, closedAt: isClosed(from) && from.isWon === to.isWon ? undefined : new Date(), ...(to.isWon ? { lostReason: null } : {}) };
  return { stageId: to.id, closedAt: null, lostReason: null };
}

async function checkUser(tx: Tx, id?: string | null) {
  if (id && !(await tx.user.count({ where: { id } }))) throw new BadRequestException('User not found');
}

async function checkRefs(tx: Tx, dto: LeadInput) {
  if (dto.contactId && !(await tx.contact.count({ where: { id: dto.contactId, archived: false } }))) throw new BadRequestException('Contact not found');
  await checkUser(tx, dto.ownerId);
}

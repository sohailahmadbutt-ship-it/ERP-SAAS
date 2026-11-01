import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Public price list for the sign-up and pricing pages. */
@Controller('plans')
export class PlansController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.plan.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, priceMonthly: true, currency: true, maxUsers: true, description: true },
    });
  }
}

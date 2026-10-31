import { Body, ConflictException, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { AuthService, publicUser } from '../auth/auth.service';
import { CreateUserDto } from '../auth/dto';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private prisma: PrismaService, private auth: AuthService) {}

  @Get()
  async list(@CurrentTenant() tenant: Tenant) {
    const users = await this.prisma.withTenant(tenant.id, (tx) => tx.user.findMany({ orderBy: { createdAt: 'asc' } }));
    return users.map(publicUser);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  async create(@CurrentTenant() tenant: Tenant, @Body() dto: CreateUserDto) {
    const passwordHash = await this.auth.hash(dto.password);
    try {
      const user = await this.prisma.withTenant(tenant.id, (tx) =>
        tx.user.create({
          data: { tenantId: tenant.id, email: dto.email.toLowerCase(), name: dto.name, passwordHash, role: dto.role ?? 'MEMBER' },
        }),
      );
      return publicUser(user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A user with that email already exists');
      }
      throw e;
    }
  }
}

import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Tenant, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RESERVED_SLUGS, SignupDto } from './dto';
import { ensureInventoryDefaults } from '../inventory/defaults';
import { ensureSalesDefaults } from '../sales/defaults';
import { ensureAccounts } from '../accounting/chart';
import { addDays, TRIAL_DAYS } from '../billing/subscription';

export interface JwtPayload {
  sub: string;
  tid: string;
  role: User['role'];
}

export const publicUser = ({ passwordHash: _omit, ...u }: User) => u;

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  hash(password: string) {
    return bcrypt.hash(password, 10);
  }

  /** Creates a company and its owner account, then signs the owner in. */
  async signup(dto: SignupDto) {
    const slug = dto.slug.toLowerCase();
    if (RESERVED_SLUGS.includes(slug)) throw new BadRequestException('That company address is reserved');
    const passwordHash = await this.hash(dto.password);
    try {
      const { tenant, user } = await this.prisma.$transaction(async (tx) => {
        const plan = await tx.plan.findFirst({ where: { code: dto.plan ?? 'business', active: true } });
        if (!plan) throw new BadRequestException('Unknown plan');
        const tenant = await tx.tenant.create({
          data: { slug, name: dto.companyName, plan: plan.code, status: 'TRIALING', trialEndsAt: addDays(new Date(), TRIAL_DAYS) },
        });
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        const user = await tx.user.create({
          data: { tenantId: tenant.id, email: dto.email.toLowerCase(), name: dto.name, passwordHash, role: 'OWNER' },
        });
        await ensureInventoryDefaults(tx, tenant.id);
        await ensureSalesDefaults(tx, tenant.id);
        await ensureAccounts(tx, tenant.id);
        return { tenant, user };
      });
      return this.session(tenant, user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('That company address is already taken');
      }
      throw e;
    }
  }

  async login(tenant: Tenant, dto: LoginDto) {
    const user = await this.prisma.withTenant(tenant.id, (tx) =>
      tx.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: dto.email.toLowerCase() } } }),
    );
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Wrong email or password');
    }
    return this.session(tenant, user);
  }

  private session(tenant: Tenant, user: User) {
    const payload: JwtPayload = { sub: user.id, tid: tenant.id, role: user.role };
    return { token: this.jwt.sign(payload), tenant, user: publicUser(user) };
  }
}

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { Tenant } from '@prisma/client';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from './auth.guard';
import { AuthService, publicUser } from './auth.service';
import { LoginDto, SignupDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Post('login')
  login(@CurrentTenant() tenant: Tenant, @Body() dto: LoginDto) {
    return this.auth.login(tenant, dto);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: Request & { auth: { sub: string } }, @CurrentTenant() tenant: Tenant) {
    const user = await this.prisma.withTenant(tenant.id, (tx) => tx.user.findUniqueOrThrow({ where: { id: req.auth.sub } }));
    return { tenant, user: publicUser(user) };
  }
}

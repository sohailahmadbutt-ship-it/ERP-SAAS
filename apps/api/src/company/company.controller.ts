import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';

export class UpdateCompanyDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  /** ISO 4217 code, e.g. PKR, USD. */
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() @MaxLength(50) taxId?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  /** ISO 3166 alpha-2 code, e.g. PK. */
  @IsOptional() @IsString() @Length(2, 2) country?: string;
}

/** The signed-in company's own profile and settings. */
@Controller('company')
@UseGuards(AuthGuard)
export class CompanyController {
  constructor(private prisma: PrismaService) {}

  @Get()
  get(@CurrentTenant() tenant: Tenant) {
    return tenant;
  }

  @Patch()
  @Roles('OWNER', 'ADMIN')
  update(@CurrentTenant() tenant: Tenant, @Body() dto: UpdateCompanyDto) {
    return this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        ...dto,
        currency: dto.currency?.toUpperCase(),
        country: dto.country?.toUpperCase(),
      },
    });
  }
}

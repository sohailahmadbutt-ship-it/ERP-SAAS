import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class PlatformLogin {
  @IsEmail() email: string;
  @IsString() password: string;
}

export class TenantQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsIn(['TRIALING', 'ACTIVE', 'SUSPENDED', 'CANCELED']) status?: string;
}

export class UpdateTenant {
  @IsOptional() @IsString() @MaxLength(40) plan?: string;
  @IsOptional() @IsIn(['TRIALING', 'ACTIVE', 'SUSPENDED', 'CANCELED']) status?: 'TRIALING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED';
  @IsOptional() @IsDateString() trialEndsAt?: string;
  @IsOptional() @IsDateString() currentPeriodEnd?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) statusNote?: string | null;
}

export class InvoiceQuery {
  @IsOptional() @IsIn(['OPEN', 'PAID', 'VOID']) status?: 'OPEN' | 'PAID' | 'VOID';
  @IsOptional() @IsUUID() tenantId?: string;
}

export class IssueInvoice {
  @IsUUID() tenantId: string;
  @IsOptional() @IsString() @MaxLength(40) planCode?: string;
}

export class MarkPaid {
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
}

export class PlanInput {
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'code must be 2-40 lowercase letters, digits or hyphens' }) code: string;
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceMonthly: number;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) maxUsers?: number | null;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class UpdatePlan {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceMonthly?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) maxUsers?: number | null;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

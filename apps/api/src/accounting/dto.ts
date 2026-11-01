import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;

export class AccountInput {
  @IsString() @Length(1, 20) code: string;
  @IsString() @Length(1, 100) name: string;
  @IsIn(ACCOUNT_TYPES) type: (typeof ACCOUNT_TYPES)[number];
}

export class UpdateAccountInput {
  @IsOptional() @IsString() @Length(1, 20) code?: string;
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class ManualLine {
  @IsUUID() accountId: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) debit?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) credit?: number;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
}

export class ManualEntryInput {
  @IsDateString() date: string;
  @IsOptional() @IsString() @MaxLength(500) memo?: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ManualLine) lines: ManualLine[];
}

export class EntryQuery {
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsIn(['MANUAL', 'INVOICE', 'INVOICE_PAYMENT', 'BILL', 'BILL_PAYMENT', 'STOCK']) source?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 50;
}

export class AsOfQuery {
  /** Inclusive. Defaults to today. */
  @IsOptional() @IsDateString() asOf?: string;
}

export class RangeQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class LedgerQuery extends RangeQuery {
  @IsUUID() accountId: string;
}

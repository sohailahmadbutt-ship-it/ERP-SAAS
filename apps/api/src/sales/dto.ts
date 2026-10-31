import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class TaxInput {
  @IsString() @Length(1, 50) name: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100) rate: number;
}

export class UpdateTaxInput {
  @IsOptional() @IsString() @Length(1, 50) name?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100) rate?: number;
  @IsOptional() archived?: boolean;
}

export class LineInput {
  @IsUUID() productId: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity: number;
  /** Defaults to the product's sale price. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) discountPct?: number;
  @IsOptional() @IsUUID() taxId?: string | null;
}

export class OrderInput {
  @IsUUID() customerId: string;
  /** Warehouse goods ship from. Defaults to the first active one. */
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsDateString() orderDate?: string;
  @IsOptional() @IsDateString() validUntil?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LineInput) lines: LineInput[];
}

export class UpdateOrderInput {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsDateString() orderDate?: string;
  @IsOptional() @IsDateString() validUntil?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LineInput) lines?: LineInput[];
}

export class DeliverLine {
  @IsUUID() lineId: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity: number;
}

export class DeliverInput {
  /** Leave out to deliver everything still outstanding. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DeliverLine) lines?: DeliverLine[];
}

export class InvoiceInput {
  @IsUUID() customerId: string;
  @IsOptional() @IsDateString() invoiceDate?: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LineInput) lines: LineInput[];
}

export class UpdateInvoiceInput {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsDateString() invoiceDate?: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LineInput) lines?: LineInput[];
}

export const PAYMENT_METHODS = ['CASH', 'BANK', 'CARD', 'CHEQUE', 'OTHER'] as const;

export class PaymentInput {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsIn(PAYMENT_METHODS) method: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @IsDateString() paymentDate?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class DocQuery {
  @IsOptional() @IsString() status?: string;
  /** Matches document number or customer name. */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 50;
}

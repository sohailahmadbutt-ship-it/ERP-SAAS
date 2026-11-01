import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

export const POS_METHODS = ['CASH', 'CARD', 'WALLET'] as const;
export type PosMethod = (typeof POS_METHODS)[number];

export class RegisterInput {
  @IsString() @Length(1, 60) name: string;
  @IsUUID() warehouseId: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() taxId?: string | null;
  @IsOptional() @IsBoolean() pricesIncludeTax?: boolean;
  @IsOptional() @IsString() @MaxLength(300) receiptFooter?: string | null;
}

export class UpdateRegisterInput {
  @IsOptional() @IsString() @Length(1, 60) name?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() taxId?: string | null;
  @IsOptional() @IsBoolean() pricesIncludeTax?: boolean;
  @IsOptional() @IsString() @MaxLength(300) receiptFooter?: string | null;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class OpenSessionInput {
  @IsUUID() registerId: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) openingCash: number;
}

export class CloseSessionInput {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) countedCash: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class SessionQuery {
  @IsOptional() @IsUUID() registerId?: string;
  @IsOptional() @IsIn(['OPEN', 'CLOSED']) status?: 'OPEN' | 'CLOSED';
}

export class CatalogQuery {
  /** Name, SKU, or an exact barcode. */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class PosLineInput {
  @IsUUID() productId: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity: number;
  /** Defaults to the product's sale price. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) discountPct?: number;
}

export class PosPaymentInput {
  @IsIn(POS_METHODS) method: PosMethod;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class PosOrderInput {
  @IsUUID() sessionId: string;
  @IsOptional() @IsUUID() customerId?: string;
  @ValidateNested({ each: true }) @Type(() => PosLineInput) @ArrayMinSize(1) @ArrayMaxSize(200) lines: PosLineInput[];
  @ValidateNested({ each: true }) @Type(() => PosPaymentInput) @ArrayMinSize(1) @ArrayMaxSize(5) payments: PosPaymentInput[];
}

export class RefundInput {
  /** The open session the money goes out of (usually the cashier's current one). */
  @IsUUID() sessionId: string;
  @IsOptional() @IsIn(POS_METHODS) method?: PosMethod;
}

export class OrderQuery {
  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsString() @MaxLength(50) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
}


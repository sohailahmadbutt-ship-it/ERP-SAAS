import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, NotEquals, ValidateIf } from 'class-validator';

const bool = ({ value }: { value: unknown }) => (value === undefined ? undefined : value === 'true' || value === true);

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 50;
}

export class UnitInput {
  @IsString() @Length(1, 10) code: string;
  @IsString() @Length(1, 50) name: string;
}

export class ProductInput {
  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsString() @MaxLength(64) sku?: string | null;
  @IsOptional() @IsString() @MaxLength(64) barcode?: string | null;
  @IsOptional() @IsIn(['GOODS', 'SERVICE']) type?: 'GOODS' | 'SERVICE';
  @IsUUID() unitId: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) salePrice?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) cost?: number;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
}

export class UpdateProductInput extends ProductInput {
  @IsOptional() @IsString() @Length(1, 200) declare name: string;
  @IsOptional() @IsUUID() declare unitId: string;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class ProductQuery extends PageQuery {
  /** Matches name, SKU or barcode. */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['GOODS', 'SERVICE']) type?: 'GOODS' | 'SERVICE';
  @IsOptional() @Transform(bool) @IsBoolean() archived?: boolean;
}

export class WarehouseInput {
  @IsString() @Length(1, 10) code: string;
  @IsString() @Length(1, 100) name: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
}

export class UpdateWarehouseInput {
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export const MOVE_KINDS = ['RECEIPT', 'DELIVERY', 'TRANSFER', 'COUNT'] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

/**
 * One stock operation:
 * - RECEIPT / DELIVERY: `quantity` in or out of `warehouseId`
 * - TRANSFER: `quantity` from `warehouseId` to `toWarehouseId`
 * - COUNT: a physical count; records the difference to `countedQuantity`
 */
export class StockMoveInput {
  @IsIn(MOVE_KINDS) kind: MoveKind;
  @IsUUID() productId: string;
  @IsUUID() warehouseId: string;

  @ValidateIf((o) => o.kind !== 'COUNT')
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001)
  quantity?: number;

  @ValidateIf((o) => o.kind === 'COUNT')
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0)
  countedQuantity?: number;

  @ValidateIf((o) => o.kind === 'TRANSFER')
  @IsUUID() @NotEquals(undefined)
  toWarehouseId?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost?: number;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class MoveQuery extends PageQuery {
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
}

export class LevelQuery {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

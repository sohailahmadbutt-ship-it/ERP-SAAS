import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { LineInput } from '../sales/dto';

export { DocQuery, PaymentInput } from '../sales/dto';

export class PurchaseOrderInput {
  @IsUUID() vendorId: string;
  /** Warehouse goods are received into. Defaults to the first active one. */
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsDateString() orderDate?: string;
  @IsOptional() @IsDateString() expectedDate?: string | null;
  @IsOptional() @IsString() @MaxLength(100) vendorRef?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  /** Unit price defaults to the product's cost. */
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LineInput) lines: LineInput[];
}

export class UpdatePurchaseOrderInput {
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsDateString() orderDate?: string;
  @IsOptional() @IsDateString() expectedDate?: string | null;
  @IsOptional() @IsString() @MaxLength(100) vendorRef?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LineInput) lines?: LineInput[];
}

export class BillInput {
  @IsUUID() vendorId: string;
  @IsOptional() @IsString() @MaxLength(100) vendorRef?: string | null;
  @IsOptional() @IsDateString() billDate?: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LineInput) lines: LineInput[];
}

export class UpdateBillInput {
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsString() @MaxLength(100) vendorRef?: string | null;
  @IsOptional() @IsDateString() billDate?: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LineInput) lines?: LineInput[];
}

export { DeliverInput as ReceiveInput } from '../sales/dto';

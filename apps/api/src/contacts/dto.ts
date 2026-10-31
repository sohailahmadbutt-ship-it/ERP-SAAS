import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';

export class ContactInput {
  @IsOptional() @IsIn(['COMPANY', 'PERSON']) kind?: 'COMPANY' | 'PERSON';
  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsEmail() email?: string | null;
  @IsOptional() @IsString() @MaxLength(50) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @Length(2, 2) country?: string | null;
  @IsOptional() @IsString() @MaxLength(50) taxId?: string | null;
  @IsOptional() @IsBoolean() isCustomer?: boolean;
  @IsOptional() @IsBoolean() isVendor?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) creditLimit?: number | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
}

export class UpdateContactInput extends ContactInput {
  @IsOptional() @IsString() @Length(1, 200) declare name: string;
  @IsOptional() @IsBoolean() archived?: boolean;
}

const bool = ({ value }: { value: unknown }) => (value === undefined ? undefined : value === 'true' || value === true);

export class ContactQuery {
  /** Matches name, email, phone or tax number. */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['customer', 'vendor']) role?: 'customer' | 'vendor';
  @IsOptional() @Transform(bool) @IsBoolean() archived?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 50;
}

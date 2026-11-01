import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const nullable = ValidateIf((_, v) => v !== null);
const bool = ({ value }: { value: unknown }) => (value === undefined ? undefined : value === 'true' || value === true);

export class StageInput {
  @IsString() @Length(1, 50) name: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) probability: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) position?: number;
}

export class UpdateStageInput {
  @IsOptional() @IsString() @Length(1, 50) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) probability?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) position?: number;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class LeadInput {
  @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsUUID() stageId?: string;
  @IsOptional() @nullable @IsUUID() contactId?: string | null;
  @IsOptional() @nullable @IsString() @MaxLength(200) companyName?: string | null;
  @IsOptional() @nullable @IsString() @MaxLength(200) personName?: string | null;
  @IsOptional() @nullable @IsEmail() email?: string | null;
  @IsOptional() @nullable @IsString() @MaxLength(50) phone?: string | null;
  @IsOptional() @nullable @IsString() @MaxLength(100) source?: string | null;
  @IsOptional() @nullable @IsUUID() ownerId?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) expectedRevenue?: number;
  @IsOptional() @nullable @IsDateString() expectedClose?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3) priority?: number;
  @IsOptional() @nullable @IsString() @MaxLength(5000) notes?: string | null;
}

export class UpdateLeadInput extends LeadInput {
  @IsOptional() @IsString() @Length(1, 200) declare title: string;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class LeadQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsUUID() contactId?: string;
  /** open (default), won, lost or all. */
  @IsOptional() @IsIn(['open', 'won', 'lost', 'all']) status?: 'open' | 'won' | 'lost' | 'all';
  @IsOptional() @Transform(bool) @IsBoolean() archived?: boolean;
}

export class LostInput {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export const ACTIVITY_TYPES = ['CALL', 'MEETING', 'EMAIL', 'TASK', 'NOTE'] as const;

export class ActivityInput {
  @IsIn(ACTIVITY_TYPES) type: (typeof ACTIVITY_TYPES)[number];
  @IsString() @Length(1, 1000) summary: string;
  @IsOptional() @nullable @IsDateString() dueAt?: string | null;
  @IsOptional() @nullable @IsUUID() assignedToId?: string | null;
}

export class UpdateActivityInput {
  @IsOptional() @IsString() @Length(1, 1000) summary?: string;
  @IsOptional() @nullable @IsDateString() dueAt?: string | null;
  @IsOptional() @IsBoolean() done?: boolean;
  @IsOptional() @nullable @IsUUID() assignedToId?: string | null;
}

export class ActivityQuery {
  /** Only activities assigned to the signed-in user. */
  @IsOptional() @Transform(bool) @IsBoolean() mine?: boolean;
  @IsOptional() @IsIn(['overdue', 'today', 'upcoming', 'open', 'done']) when?: 'overdue' | 'today' | 'upcoming' | 'open' | 'done';
}

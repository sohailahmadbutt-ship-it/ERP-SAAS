import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const RESERVED_SLUGS = ['www', 'api', 'app', 'admin', 'docs', 'mail', 'static'];

export class SignupDto {
  @IsString() @MinLength(2) @MaxLength(100)
  companyName: string;

  /** Becomes the company's subdomain. */
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, {
    message: 'slug must be 3-32 lowercase letters, digits or hyphens',
  })
  slug: string;

  @IsString() @MinLength(1) @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsString() @MinLength(8) @MaxLength(128)
  password: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class CreateUserDto {
  @IsString() @MinLength(1) @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsString() @MinLength(8) @MaxLength(128)
  password: string;

  @IsOptional() @IsIn(['ADMIN', 'MEMBER'])
  role?: 'ADMIN' | 'MEMBER';
}

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface PlatformJwt {
  sub: string;
  scope: 'platform';
}

/** Requires a platform console token. Company tokens never pass (they have no platform scope). */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const token = /^Bearer (.+)$/.exec(req.header('authorization') ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    try {
      const payload = this.jwt.verify<PlatformJwt>(token);
      if (payload.scope !== 'platform') throw new Error('not a platform token');
      req.platform = payload;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

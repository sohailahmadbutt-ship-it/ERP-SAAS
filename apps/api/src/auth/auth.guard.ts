import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
import type { JwtPayload } from './auth.service';
import { accessOf } from '../billing/subscription';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Lets a route make changes even when the subscription is read-only (paying for it, for example). */
export const ALLOW_INACTIVE_KEY = 'allowInactive';
export const AllowInactive = () => SetMetadata(ALLOW_INACTIVE_KEY, true);

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const READ_ONLY_MESSAGES: Record<string, string> = {
  trial_expired: 'Your free trial has ended. Choose a plan in Settings > Billing to keep making changes.',
  expired: 'Your subscription has expired. Pay the open invoice in Settings > Billing to keep making changes.',
  suspended: 'This company has been suspended. Contact support.',
  canceled: 'This subscription was canceled. Choose a plan in Settings > Billing to reactivate it.',
};

/**
 * Requires a valid token issued for the same company the request is for,
 * so a token from one tenant can never be used against another.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const token = /^Bearer (.+)$/.exec(req.header('authorization') ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (!req.tenant || req.tenant.id !== payload.tid) throw new UnauthorizedException();
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles && !roles.includes(payload.role)) throw new ForbiddenException();
    if (!READ_METHODS.includes(req.method)) {
      const { state, access } = accessOf(req.tenant);
      const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_INACTIVE_KEY, [ctx.getHandler(), ctx.getClass()]);
      if (access === 'read_only' && !allowed) {
        throw new HttpException({ statusCode: 402, error: 'Payment Required', state, message: READ_ONLY_MESSAGES[state] }, HttpStatus.PAYMENT_REQUIRED);
      }
    }
    req.auth = payload;
    return true;
  }
}

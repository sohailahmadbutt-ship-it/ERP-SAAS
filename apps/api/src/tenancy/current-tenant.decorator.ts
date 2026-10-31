import { createParamDecorator, ExecutionContext, NotFoundException } from '@nestjs/common';

/** Injects the tenant resolved by TenantMiddleware, or 404s if there is none. */
export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const tenant = ctx.switchToHttp().getRequest().tenant;
  if (!tenant) throw new NotFoundException('Unknown company');
  return tenant;
});

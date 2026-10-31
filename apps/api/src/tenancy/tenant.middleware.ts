import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Tenant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: Tenant;
  }
}

/**
 * Works out which company a request is for: the X-Tenant header if present
 * (used by the web app and API clients), otherwise the subdomain of the Host
 * (acme.yourerp.com -> "acme").
 */
export function tenantSlugFrom(req: Request, rootDomain = process.env.ROOT_DOMAIN ?? 'localhost') {
  const header = req.header('x-tenant');
  if (header) return header.toLowerCase();
  const host = (req.hostname ?? '').toLowerCase();
  if (host.endsWith(`.${rootDomain}`)) {
    const sub = host.slice(0, -(rootDomain.length + 1));
    if (sub && !sub.includes('.') && sub !== 'www') return sub;
  }
  return undefined;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const slug = tenantSlugFrom(req);
    if (slug) {
      req.tenant = (await this.prisma.tenant.findUnique({ where: { slug } })) ?? undefined;
    }
    next();
  }
}

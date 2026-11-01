import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Caddy asks this before issuing an HTTPS certificate on demand, so
 * certificates are only requested for the main domain and real companies,
 * never for any random name someone points at the server.
 */
@Controller('tls')
export class TlsController {
  constructor(private prisma: PrismaService) {}

  @Get('allowed')
  async allowed(@Query('domain') domain = '') {
    const root = (process.env.ROOT_DOMAIN ?? 'localhost').toLowerCase();
    const host = domain.toLowerCase();
    if ([root, `www.${root}`, `api.${root}`].includes(host)) return { ok: true };
    if (host.endsWith(`.${root}`)) {
      const slug = host.slice(0, -(root.length + 1));
      if (!slug.includes('.') && (await this.prisma.tenant.count({ where: { slug } }))) return { ok: true };
    }
    throw new NotFoundException();
  }
}

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  /**
   * Runs `fn` in a transaction where Postgres row-level security only exposes
   * rows belonging to `tenantId`. All tenant-scoped queries must go through here.
   */
  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Runs `fn` for the platform console. Postgres lets it see every company's
   * platform invoices and read users; all other tenant tables stay hidden.
   */
  asPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.platform', 'on', true)`;
      return fn(tx);
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

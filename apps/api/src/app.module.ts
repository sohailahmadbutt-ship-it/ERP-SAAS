import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma/prisma.service';
import { TenantMiddleware } from './tenancy/tenant.middleware';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { UsersController } from './users/users.controller';
import { HealthController } from './health/health.controller';
import { CompanyController } from './company/company.controller';
import { ContactsController } from './contacts/contacts.controller';
import { UnitsController } from './inventory/units.controller';
import { WarehousesController } from './inventory/warehouses.controller';
import { ProductsController } from './inventory/products.controller';
import { StockController } from './inventory/stock.controller';
import { StockService } from './inventory/stock.service';
import { TaxesController } from './sales/taxes.controller';
import { SalesOrdersController } from './sales/sales-orders.controller';
import { InvoicesController } from './sales/invoices.controller';
import { PurchaseOrdersController } from './purchase/purchase-orders.controller';
import { BillsController } from './purchase/bills.controller';
import { AccountingController } from './accounting/accounting.controller';
import { AccountingService } from './accounting/accounting.service';
import { BillingController } from './billing/billing.controller';
import { PlansController } from './billing/plans.controller';
import { PlatformController } from './platform/platform.controller';
import { PosController } from './pos/pos.controller';
import { PosService } from './pos/pos.service';
import { CrmController } from './crm/crm.controller';
import { TlsController } from './tenancy/tls.controller';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [HealthController, AuthController, UsersController, CompanyController, ContactsController, UnitsController, WarehousesController, ProductsController, StockController, TaxesController, SalesOrdersController, InvoicesController, PurchaseOrdersController, BillsController, AccountingController, BillingController, PlansController, PlatformController, PosController, CrmController, TlsController],
  providers: [PrismaService, AuthService, StockService, AccountingService, PosService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

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

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [HealthController, AuthController, UsersController, CompanyController, ContactsController, UnitsController, WarehousesController, ProductsController, StockController],
  providers: [PrismaService, AuthService, StockService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET ?? '').length < 32) {
    throw new Error('Set JWT_SECRET to a random value of at least 32 characters');
  }
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('ERP SaaS API').setVersion('0.1').addBearerAuth().build(),
  );
  SwaggerModule.setup('docs', app, doc);
  await app.listen(Number(process.env.API_PORT ?? 4000));
}
bootstrap();

import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Shared setup for the real server and the e2e tests. */
export function configureApp(app: INestApplication) {
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}

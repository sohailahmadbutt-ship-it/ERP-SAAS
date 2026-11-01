/**
 * Creates (or resets the password of) a platform console admin.
 *
 *   PLATFORM_ADMIN_PASSWORD='...' node dist/platform/create-admin.js you@example.com "Your Name"
 *
 * The password comes from the environment so it stays out of shell history and process lists.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  const [email, name = 'Platform admin'] = process.argv.slice(2);
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    console.error('Usage: PLATFORM_ADMIN_PASSWORD=<at least 12 characters> node dist/platform/create-admin.js <email> [name]');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.platformAdmin.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), name, passwordHash },
    update: { passwordHash },
  });
  console.log(`Platform admin ready: ${admin.email}`);
  await prisma.$disconnect();
}

void main();

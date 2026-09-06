const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv/config');

async function main() {
  const email = process.argv[2];

  if (!email) {
    throw new Error('Usage: node scripts/debug-login-session.cjs email@example.com');
  }

  const adapter = new PrismaPg(
    new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  );
  const prisma = new PrismaClient({ adapter });

  const user = await prisma.user.findUnique({ where: { email } });
  console.log({ found: Boolean(user), locked: Boolean(user?.activeSessionId) });

  if (user) {
    console.log({ passwordMatches: await bcrypt.compare('password', user.passwordHash) });
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        activeSessionId: crypto.randomUUID(),
        activeSessionStartedAt: new Date(),
      },
    });
    console.log({ updated: updatedUser.email, locked: Boolean(updatedUser.activeSessionId) });
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

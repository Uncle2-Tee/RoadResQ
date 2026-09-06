import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const databaseUrl =
  process.env.USE_DIRECT_URL === 'true'
    ? process.env.DIRECT_URL || process.env.DATABASE_URL
    : process.env.DATABASE_URL || process.env.DIRECT_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for Prisma.');
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10000,
});
const adapter = new PrismaPg(pool);
const cachedPrisma = globalForPrisma.prisma as (PrismaClient & {
  requestHistory?: unknown;
  mechanicShop?: unknown;
  towShop?: unknown;
}) | undefined;

export const prisma =
  cachedPrisma?.requestHistory && cachedPrisma?.mechanicShop && cachedPrisma?.towShop
    ? cachedPrisma
    :
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

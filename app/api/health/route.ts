import { isDatabaseConnectionError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const withTimeout = async <T,>(promise: Promise<T>, ms = 10000) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Database health check timed out')), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export async function GET() {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`);
    return Response.json({
      ok: true,
      database: {
        ok: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database is unreachable';
    return Response.json({
      ok: true,
      database: {
        ok: false,
        error: isDatabaseConnectionError(error)
          ? 'Database is unreachable from the local backend. Check your network/firewall or try a hotspot.'
          : message,
      },
    });
  }
}

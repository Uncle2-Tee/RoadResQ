import { isDatabaseConnectionError, jsonError, normalizeEmail } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const AUTH_DATABASE_TIMEOUT_MS = 15000;

const withTimeout = async <T,>(promise: Promise<T>, message: string, ms = AUTH_DATABASE_TIMEOUT_MS) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = normalizeEmail(body.email);

    if (!email) {
      return jsonError('Email is required', 400);
    }

    const existingUser = await withTimeout(
      prisma.user.findUnique({ where: { email } }),
      'Check email database query timed out'
    );
    return Response.json({ available: !existingUser });
  } catch (error) {
    console.error('[auth] check-email failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to check email', 500);
  }
}

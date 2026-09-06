import { isDatabaseConnectionError, jsonError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const withTimeout = async <T,>(promise: Promise<T>, message: string, ms = 6000) => {
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
    const userId = String(body.userId || '').trim();
    const sessionId = String(body.sessionId || '').trim();

    if (!userId || !sessionId) {
      return jsonError('userId and sessionId are required', 400);
    }

    await withTimeout(
      prisma.user.updateMany({
        where: {
          id: userId,
          activeSessionId: sessionId,
        },
        data: {
          activeSessionId: null,
          activeSessionStartedAt: null,
        },
      }),
      'Logout database query timed out'
    );

    return Response.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('[auth] logout failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to logout', 500);
  }
}

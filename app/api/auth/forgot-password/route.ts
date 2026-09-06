import crypto from 'crypto';

import { isDatabaseConnectionError, jsonError, normalizeEmail } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const AUTH_DATABASE_TIMEOUT_MS = 15000;
const RESET_CODE_EXPIRY_MINUTES = 2;

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

const hashResetCode = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

const createResetCode = () => crypto.randomInt(100000, 1000000).toString();

export async function POST(request: Request) {
  try {
    let body: { email?: unknown };
    try {
      body = await request.json();
    } catch {
      return jsonError('Email is required', 400);
    }

    const email = normalizeEmail(body.email);
    if (!email) {
      return jsonError('Email is required', 400);
    }

    const user = await withTimeout(
      prisma.user.findUnique({ where: { email } }),
      'Password reset user lookup timed out'
    );

    const genericMessage = 'If this email is registered, a password reset code has been created.';

    if (!user) {
      return Response.json({ message: genericMessage });
    }

    const resetCode = createResetCode();
    const expiresAt = new Date(Date.now() + RESET_CODE_EXPIRY_MINUTES * 60 * 1000);

    await withTimeout(
      prisma.$transaction([
        prisma.passwordResetToken.updateMany({
          where: {
            userId: user.id,
            usedAt: null,
            expiresAt: {
              gt: new Date(),
            },
          },
          data: {
            usedAt: new Date(),
          },
        }),
        prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashResetCode(resetCode),
            expiresAt,
          },
        }),
      ]),
      'Password reset token creation timed out'
    );

    return Response.json({
      message: 'Use the reset code shown below to set a new password.',
      expiresAt: expiresAt.toISOString(),
      resetCode,
    });
  } catch (error) {
    console.error('[auth] forgot-password failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to create password reset code', 500);
  }
}

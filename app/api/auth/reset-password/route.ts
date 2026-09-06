import bcrypt from 'bcryptjs';
import crypto from 'crypto';

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

const normalizeResetCode = (code: unknown) => String(code || '').replace(/\D/g, '');

const hashResetCode = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

export async function POST(request: Request) {
  try {
    let body: {
      email?: unknown;
      token?: unknown;
      resetCode?: unknown;
      newPassword?: unknown;
      confirmPassword?: unknown;
    };

    try {
      body = await request.json();
    } catch {
      return jsonError('Email, reset code, and new password are required', 400);
    }

    const email = normalizeEmail(body.email);
    const resetCode = normalizeResetCode(body.token || body.resetCode);
    const newPassword = String(body.newPassword || '');
    const confirmPassword = String(body.confirmPassword || '');

    if (!email || !resetCode || !newPassword || !confirmPassword) {
      return jsonError('Email, reset code, and new password are required', 400);
    }

    if (resetCode.length !== 6) {
      return jsonError('Reset code must be 6 digits', 400);
    }

    if (newPassword !== confirmPassword) {
      return jsonError('Passwords do not match', 400);
    }

    if (newPassword.length < 6) {
      return jsonError('Password must be at least 6 characters', 400);
    }

    const tokenHash = hashResetCode(resetCode);
    const resetToken = await withTimeout(
      prisma.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      }),
      'Password reset token lookup timed out'
    );

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() < Date.now() ||
      resetToken.user.email !== email
    ) {
      return jsonError('Invalid or expired reset code', 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await withTimeout(
      prisma.$transaction([
        prisma.user.update({
          where: { id: resetToken.userId },
          data: {
            passwordHash,
            activeSessionId: null,
            activeSessionStartedAt: null,
          },
        }),
        prisma.passwordResetToken.update({
          where: { id: resetToken.id },
          data: { usedAt: new Date() },
        }),
        prisma.passwordResetToken.updateMany({
          where: {
            userId: resetToken.userId,
            id: {
              not: resetToken.id,
            },
            usedAt: null,
          },
          data: { usedAt: new Date() },
        }),
      ]),
      'Password reset update timed out'
    );

    return Response.json({ message: 'Password reset successfully. You can now login with your new password.' });
  } catch (error) {
    console.error('[auth] reset-password failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to reset password', 500);
  }
}

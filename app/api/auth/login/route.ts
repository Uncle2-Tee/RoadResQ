import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import {
  isDatabaseConnectionError,
  jsonError,
  normalizeEmail,
  toPublicUser,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const AUTH_DATABASE_TIMEOUT_MS = 15000;

const ACTIVE_SESSION_TTL_MS = Number(
  process.env.ACTIVE_SESSION_TTL_MS ||
    1000 * 60 * 60 * 12
);

type UserRecord = {
  id: string;
  passwordHash: string;
  activeSessionId: string | null;
  activeSessionStartedAt: Date | null;
};

const withTimeout = async <T,>(
  promise: Promise<T>,
  message: string,
  ms = AUTH_DATABASE_TIMEOUT_MS
): Promise<T> => {
  let timeoutId:
    | ReturnType<typeof setTimeout>
    | undefined;

  const timeout = new Promise<never>(
    (_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(message)),
        ms
      );
    }
  );

  try {
    return await Promise.race([
      promise,
      timeout,
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export async function POST(request: Request) {
  let email = '';
  let password = '';

  try {
    let body: {
      email?: unknown;
      password?: unknown;
      forceLogin?: unknown;
    };

    try {
      body = await request.json();
    } catch {
      return jsonError(
        'Invalid login request. Email and password are required.',
        400
      );
    }

    email = normalizeEmail(body.email);
    password = String(body.password || '');

    if (!email || !password) {
      return jsonError(
        'Email and password are required',
        400
      );
    }

    const user = await withTimeout(
      prisma.user.findUnique({
        where: {
          email,
        },
      }) as Promise<UserRecord | null>,
      'Login database query timed out'
    );

    if (!user) {
      return jsonError(
        'Invalid email or password',
        401
      );
    }

    const passwordMatches =
      await bcrypt.compare(
        password,
        user.passwordHash
      );

    if (!passwordMatches) {
      return jsonError(
        'Invalid email or password',
        401
      );
    }

    const forceLogin =
      body.forceLogin === true;

    const sessionAgeMs =
      user.activeSessionStartedAt
        ? Date.now() -
          user.activeSessionStartedAt.getTime()
        : Number.POSITIVE_INFINITY;

    const sessionIsStale =
      sessionAgeMs > ACTIVE_SESSION_TTL_MS;

    if (
      user.activeSessionId &&
      !forceLogin &&
      !sessionIsStale
    ) {
      return jsonError(
        'This account is already logged in on another device. Please logout from that device first.',
        409
      );
    }

    const sessionId =
      crypto.randomUUID();

    const loggedInUser =
      await withTimeout(
        prisma.user.update({
          where: {
            id: user.id,
          },
          data: {
            activeSessionId: sessionId,
            activeSessionStartedAt:
              new Date(),
          },
        }),
        'Login session database query timed out'
      );

    return Response.json({
      message: 'Login successful',
      user: {
        ...toPublicUser(loggedInUser),
        sessionId,
      },
    });
  } catch (error) {
    console.error(
      '[auth] login failed:',
      error
    );

    if (
      isDatabaseConnectionError(error)
    ) {
      return jsonError(
        'Database is unreachable from the local backend. Check your network/firewall or try a hotspot.',
        503
      );
    }

    return jsonError(
      'Unable to login',
      500
    );
  }
}
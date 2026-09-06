import bcrypt from 'bcryptjs';

import { isDatabaseConnectionError, jsonError, normalizeEmail, toPublicUser } from '@/lib/auth';
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
    const name = String(body.fullName || body.name || '').trim();
    const email = normalizeEmail(body.email);
    const phoneNumber = String(body.phone || body.phoneNumber || '').trim();
    const role = String(body.role || '').trim();
    const password = String(body.password || '');
    const confirmPassword = String(body.confirmPassword || password);

    if (!name || !email || !phoneNumber || !role || !password) {
      return jsonError('Name, email, phone number, role, and password are required', 400);
    }

    if (!['driver', 'mechanic', 'tower'].includes(role)) {
      return jsonError('Role must be driver, mechanic, or tower', 400);
    }

    if (password !== confirmPassword) {
      return jsonError('Passwords do not match', 400);
    }

    if (password.length < 6) {
      return jsonError('Password must be at least 6 characters', 400);
    }

    const existingUser = await withTimeout(
      prisma.user.findUnique({ where: { email } }),
      'Signup email database query timed out'
    );
    if (existingUser) {
      return jsonError('This email is already registered', 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await withTimeout(
      prisma.user.create({
        data: {
          name,
          email,
          phoneNumber,
          role,
          passwordHash,
        },
      }),
      'Signup database query timed out'
    );

    return Response.json(
      {
        message: 'Account created successfully',
        user: toPublicUser(user),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[auth] signup failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to create account', 500);
  }
}

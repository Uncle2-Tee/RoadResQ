import type { User } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: string;
  profilePhotoUri: string | null;
  createdAt: string;
};

export function normalizeEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phoneNumber,
    role: user.role,
    profilePhotoUri: user.profilePhotoUri,
    createdAt: user.createdAt.toISOString(),
  };
}

export function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function requireAdmin(request: Request) {
  const userId = request.headers.get('x-user-id')?.trim();
  const sessionId = request.headers.get('x-session-id')?.trim();
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);

  if (!userId || !sessionId || !adminEmail) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, activeSessionId: true },
  });

  if (
    !user ||
    normalizeEmail(user.email) !== adminEmail ||
    user.role !== 'admin' ||
    user.activeSessionId !== sessionId
  ) {
    return null;
  }

  return user;
}

export function isDatabaseConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as {
    code?: string;
    cause?: unknown;
    errors?: Array<{ code?: string }>;
    message?: string;
  };
  const message = maybeError.message?.toLowerCase() || '';

  return (
    maybeError.code === 'EACCES' ||
    maybeError.code === 'ETIMEDOUT' ||
    maybeError.code === 'ECONNRESET' ||
    maybeError.code === 'P1011' ||
    maybeError.code === 'P1001' ||
    maybeError.code === 'P1002' ||
    maybeError.code === 'P1008' ||
    maybeError.code === 'P1017' ||
    maybeError.code === 'P2024' ||
    maybeError.errors?.some((inner) => inner.code === 'EACCES') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('connection') ||
    message.includes('database is unreachable') ||
    isDatabaseConnectionError(maybeError.cause)
  );
}

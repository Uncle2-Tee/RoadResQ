import { isDatabaseConnectionError, jsonError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isExpoPushToken } from '@/lib/push-notifications';

const PROVIDER_ROLES = new Set(['mechanic', 'tower']);

const normalizeRole = (role: unknown) => String(role || '').trim().toLowerCase();
const normalizeOptionalText = (value: unknown) => String(value || '').trim() || null;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userId = String(body.userId || '').trim();
    const token = String(body.token || '').trim();
    const role = normalizeRole(body.role);

    if (!userId || !token) {
      return jsonError('userId and token are required', 400);
    }

    if (!isExpoPushToken(token)) {
      return jsonError('A valid Expo push token is required', 400);
    }

    if (!PROVIDER_ROLES.has(role)) {
      return jsonError('Only mechanics and towers can receive request notifications', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      return jsonError('User not found', 404);
    }

    if (!PROVIDER_ROLES.has(user.role)) {
      return jsonError('Only mechanic and tower accounts can receive request notifications', 400);
    }

    const pushToken = await prisma.pushToken.upsert({
      where: { token },
      update: {
        userId: user.id,
        role: user.role,
        platform: normalizeOptionalText(body.platform),
        lastSeenAt: new Date(),
      },
      create: {
        token,
        userId: user.id,
        role: user.role,
        platform: normalizeOptionalText(body.platform),
        lastSeenAt: new Date(),
      },
    });

    return Response.json({
      message: 'Push token registered',
      pushToken: {
        id: pushToken.id,
        userId: pushToken.userId,
        platform: pushToken.platform,
        role: pushToken.role,
        lastSeenAt: pushToken.lastSeenAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[push-tokens] register failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to register push token', 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const userId = String(body.userId || '').trim();
    const token = String(body.token || '').trim();

    if (!userId || !token) {
      return jsonError('userId and token are required', 400);
    }

    await prisma.pushToken.deleteMany({
      where: {
        userId,
        token,
      },
    });

    return Response.json({ message: 'Push token removed' });
  } catch (error) {
    console.error('[push-tokens] remove failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to remove push token', 500);
  }
}

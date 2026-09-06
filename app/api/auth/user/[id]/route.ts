import { isDatabaseConnectionError, jsonError, toPublicUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return jsonError('User not found', 404);
    }

    return Response.json({ user: toPublicUser(user) });
  } catch (error) {
    console.error('[auth] get user failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to fetch user', 500);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const data: {
      name?: string;
      phoneNumber?: string;
      profilePhotoUri?: string | null;
    } = {};

    if (typeof body.name === 'string') {
      data.name = body.name.trim();
    }

    if (typeof body.phone === 'string') {
      data.phoneNumber = body.phone.trim();
    }

    if (typeof body.profilePhotoUri === 'string') {
      data.profilePhotoUri = body.profilePhotoUri.trim() || null;
    }

    if (body.profilePhotoUri === null) {
      data.profilePhotoUri = null;
    }

    const user = await prisma.user.update({
      where: { id },
      data,
    });

    return Response.json({ user: toPublicUser(user) });
  } catch (error) {
    console.error('[auth] update user failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to update user', 500);
  }
}

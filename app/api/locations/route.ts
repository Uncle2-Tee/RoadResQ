import { isDatabaseConnectionError, jsonError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const userId = request.headers.get('x-user-id')?.trim();
    if (!userId) return jsonError('You must be signed in to track location', 401);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || !['driver', 'mechanic', 'tower'].includes(user.role)) return jsonError('Unsupported location owner', 403);
    const body = await request.json();
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const accuracy = body.accuracy === undefined ? null : Number(body.accuracy);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return jsonError('Valid latitude and longitude are required', 400);
    }
    if (user.role === 'driver') {
      await prisma.driverLocationTrack.create({
        data: {
          driverId: userId,
          latitude,
          longitude,
          accuracy: Number.isFinite(accuracy) ? accuracy : null,
          source: String(body.source || 'gps').trim() || 'gps',
        },
      });
    } else {
      await prisma.providerLocationTrack.create({
        data: {
          providerId: userId,
          latitude,
          longitude,
          accuracy: Number.isFinite(accuracy) ? accuracy : null,
        },
      });
    }
    return Response.json({ saved: true }, { status: 201 });
  } catch (error) {
    console.error('[locations] save failed:', error);
    if (isDatabaseConnectionError(error)) return jsonError('Database is unreachable', 503);
    return jsonError('Unable to save location', 500);
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerIds = searchParams.getAll('providerId').map((id) => id.trim()).filter(Boolean);
    if (providerIds.length === 0) return jsonError('At least one providerId is required', 400);

    const tracks = await prisma.providerLocationTrack.findMany({
      where: { providerId: { in: providerIds } },
      orderBy: { recordedAt: 'desc' },
      distinct: ['providerId'],
    });

    return Response.json({
      locations: tracks.map((track) => ({
        providerId: track.providerId,
        latitude: Number(track.latitude),
        longitude: Number(track.longitude),
        accuracy: track.accuracy === null ? null : Number(track.accuracy),
        recordedAt: track.recordedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[locations] provider lookup failed:', error);
    if (isDatabaseConnectionError(error)) return jsonError('Database is unreachable', 503);
    return jsonError('Unable to load provider locations', 500);
  }
}
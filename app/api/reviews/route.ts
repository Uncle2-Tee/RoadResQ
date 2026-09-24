import { isDatabaseConnectionError, jsonError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const toProviderType = (value: unknown) => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'TOW' ? 'TOW' : normalized === 'MECHANIC' ? 'MECHANIC' : null;
};

export async function POST(request: Request) {
  try {
    const driverId = request.headers.get('x-user-id')?.trim();
    if (!driverId) return jsonError('You must be signed in to rate a provider', 401);
    const driver = await prisma.user.findUnique({ where: { id: driverId }, select: { role: true } });
    if (driver?.role !== 'driver') return jsonError('Only drivers can rate providers', 403);

    const body = await request.json();
    const providerType = toProviderType(body.providerType);
    const providerId = String(body.providerId || '').trim();
    const rating = Number(body.rating);
    if (!providerType || !providerId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return jsonError('providerType, providerId, and a rating from 1 to 5 are required', 400);
    }

    const shop = providerType === 'TOW'
      ? await prisma.towShop.findUnique({ where: { shopId: providerId }, select: { id: true } })
      : await prisma.mechanicShop.findUnique({ where: { shopId: providerId }, select: { id: true } });
    if (!shop) return jsonError('Provider not found', 404);

    const review = await prisma.providerReview.upsert({
      where: { driverId_providerType_providerId: { driverId, providerType, providerId } },
      create: {
        driverId,
        providerType,
        providerId,
        ...(providerType === 'TOW' ? { towShopId: shop.id } : { mechanicShopId: shop.id }),
        rating,
      },
      update: { rating },
    });
    return Response.json({ review: { providerId: review.providerId, rating: review.rating } });
  } catch (error) {
    console.error('[reviews] save failed:', error);
    if (isDatabaseConnectionError(error)) return jsonError('Database is unreachable', 503);
    return jsonError('Unable to save rating', 500);
  }
}
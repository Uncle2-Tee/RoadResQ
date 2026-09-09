import { isDatabaseConnectionError, jsonError, requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected']);

type ShopRecord =
  | Awaited<ReturnType<typeof prisma.mechanicShop.findMany>>[number]
  | Awaited<ReturnType<typeof prisma.towShop.findMany>>[number];

const toShopResponse = (
  shop: ShopRecord,
  providerType: 'registered' | 'tow'
) => ({
  id: shop.id,
  shopId: shop.shopId,
  mechanicId: shop.mechanicId,
  shopName: shop.shopName,
  phone: shop.phone,
  location: shop.location,
  specialization: shop.specialization,
  licenseNumber: shop.licenseNumber,
  latitude: Number(shop.latitude),
  longitude: Number(shop.longitude),
  providerType,
  status: shop.status,
  approvalStatus: shop.approvalStatus,
  bankName: shop.bankName,
  bankCode: shop.bankCode,
  accountNumber: shop.accountNumber,
  accountName: shop.accountName,
  paystackSubaccountCode: shop.paystackSubaccountCode,
  createdAt: shop.createdAt.toISOString(),
  updatedAt: shop.updatedAt.toISOString(),
});

export async function GET(request: Request) {
  try {
    if (!(await requireAdmin(request))) {
      return jsonError('Admin access required', 403);
    }

    const [mechanicShops, towShops] = await Promise.all([
      prisma.mechanicShop.findMany(),
      prisma.towShop.findMany(),
    ]);

    const shops = [
      ...mechanicShops.map((shop: ShopRecord) =>
        toShopResponse(shop, 'registered')
      ),
      ...towShops.map((shop: ShopRecord) =>
        toShopResponse(shop, 'tow')
      ),
    ].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );

    return Response.json({ shops });
  } catch (error) {
    console.error('[admin/mechanic-shops] list failed:', error);

    if (isDatabaseConnectionError(error)) {
      return jsonError(
        'Database is unreachable from the local backend.',
        503
      );
    }

    return jsonError('Unable to load shop approvals', 500);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!(await requireAdmin(request))) {
      return jsonError('Admin access required', 403);
    }

    const body = await request.json();

    const shopId = String(body.shopId || '').trim();
    const approvalStatus = String(body.status || '')
      .trim()
      .toLowerCase();
    const providerType = String(body.providerType || '')
      .trim()
      .toLowerCase();

    if (!shopId || !APPROVAL_STATUSES.has(approvalStatus)) {
      return jsonError(
        'shopId and a valid approval status are required',
        400
      );
    }

    if (
      providerType !== '' &&
      providerType !== 'registered' &&
      providerType !== 'tow'
    ) {
      return jsonError(
        'providerType must be registered or tow',
        400
      );
    }

    const mechanicShop =
      providerType === 'tow'
        ? null
        : await prisma.mechanicShop.findUnique({
            where: { shopId },
          });

    const shop = mechanicShop
      ? await prisma.mechanicShop.update({
          where: { shopId },
          data: { approvalStatus },
        })
      : await prisma.towShop.update({
          where: { shopId },
          data: { approvalStatus },
        });

    return Response.json({
      shop: toShopResponse(
        shop,
        mechanicShop ? 'registered' : 'tow'
      ),
    });
  } catch (error: any) {
    console.error('[admin/mechanic-shops] update failed:', error);

    if (error?.code === 'P2025') {
      return jsonError('Shop not found', 404);
    }

    if (isDatabaseConnectionError(error)) {
      return jsonError(
        'Database is unreachable from the local backend.',
        503
      );
    }

    return jsonError('Unable to update shop approval', 500);
  }
}
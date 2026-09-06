import { isDatabaseConnectionError, jsonError } from '@/lib/auth';
import { createPaystackSubaccount, hasPaystackSecretKey } from '@/lib/paystack';
import { prisma } from '@/lib/prisma';

const GHANA_CARD_NUMBER_PATTERN = /^GHA-\d{9}-\d$/;

type ShopRecord =
  | Awaited<ReturnType<typeof prisma.mechanicShop.findMany>>[number]
  | Awaited<ReturnType<typeof prisma.towShop.findMany>>[number];

const toShopResponse = (shop: ShopRecord, providerType: 'registered' | 'tow') => ({
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

const removedShopNames = new Set([
  'elliot auto',
  'elliot autos',
  'elliots auto',
  'elliots autos',
  'fast fix',
  'fast fixes',
]);

const normalizeShopNameForRemoval = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isRemovedShopName = (name: string) => removedShopNames.has(normalizeShopNameForRemoval(name));

const withTimeout = async <T,>(promise: Promise<T>, message: string, ms = 6000) => {
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

const getExistingMechanicId = async (value: unknown) => {
  const id = String(value || '').trim();
  if (!id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });

  return user?.role === 'mechanic' || user?.role === 'tower' ? user.id : null;
};

const toFiniteNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerType = String(searchParams.get('providerType') || '').trim().toLowerCase();
    if (providerType !== '' && providerType !== 'registered' && providerType !== 'tow') {
      return jsonError('providerType must be registered or tow', 400);
    }
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const isTow = providerType === 'tow';
    const shops = await withTimeout(
      isTow
        ? prisma.towShop.findMany({
            where: {
              approvalStatus: 'approved',
              ...(includeInactive ? {} : { status: { not: 'inactive' } }),
            },
            orderBy: { createdAt: 'desc' },
          }) as Promise<ShopRecord[]>
        : prisma.mechanicShop.findMany({
        where: {
          approvalStatus: 'approved',
          ...(includeInactive ? {} : { status: { not: 'inactive' } }),
        },
        orderBy: { createdAt: 'desc' },
          }) as Promise<ShopRecord[]>,
      'Mechanic shop database query timed out'
    );

    return Response.json({
      shops: shops.filter((shop) => !isRemovedShopName(shop.shopName)).map((shop) =>
        toShopResponse(shop, isTow ? 'tow' : 'registered')
      ),
    });
  } catch (error) {
    console.error('[mechanic-shops] list failed:', error);
    if (isDatabaseConnectionError(error) || (error instanceof Error && error.message.includes('timed out'))) {
      return jsonError('Mechanic shops are temporarily unavailable. Please try again shortly.', 503);
    }

    return jsonError('Unable to load mechanic shops', 500);
  }
}

const toShopStatus = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'active' || normalized === 'inactive') {
    return normalized;
  }

  return null;
};

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const shopId = String(body.shopId || '').trim();
    const providerType = String(body.providerType || '').trim().toLowerCase();
    const status = toShopStatus(body.status);
    const shopName = typeof body.shopName === 'string' ? body.shopName.trim() : undefined;

    if (!shopId) {
      return jsonError('shopId is required', 400);
    }

    if (providerType !== '' && providerType !== 'registered' && providerType !== 'tow') {
      return jsonError('providerType must be registered or tow', 400);
    }

    if (body.status !== undefined && !status) {
      return jsonError('status must be active or inactive', 400);
    }

    if (body.shopName !== undefined && !shopName) {
      return jsonError('shopName cannot be empty', 400);
    }

    if (!status && shopName === undefined) {
      return jsonError('Provide status or shopName to update', 400);
    }

    const data = {
      ...(status ? { status } : {}),
      ...(shopName !== undefined ? { shopName } : {}),
    };
    const mechanicShop = providerType === 'tow'
      ? null
      : await prisma.mechanicShop.findUnique({ where: { shopId } });
    const savedShop = mechanicShop
      ? await prisma.mechanicShop.update({ where: { shopId }, data })
      : await prisma.towShop.update({ where: { shopId }, data });

    return Response.json({ shop: toShopResponse(savedShop, mechanicShop ? 'registered' : 'tow') });
  } catch (error: any) {
    console.error('[mechanic-shops] update failed:', error);
    if (error?.code === 'P2025') {
      return jsonError('Shop not found', 404);
    }

    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to update mechanic shop', 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const shopId = String(body.shopId || `shop-${Date.now()}`).trim();
    const shopName = String(body.shopName || body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const location = String(body.location || '').trim();
    const specialization = String(body.specialization || '').trim();
    const licenseNumber = String(body.licenseNumber || '').trim().toUpperCase();
    const bankName = String(body.bankName || '').trim();
    const bankCode = String(body.bankCode || '').trim();
    const accountNumber = String(body.accountNumber || '').trim();
    const accountName = String(body.accountName || '').trim();
    const latitude = toFiniteNumber(body.latitude);
    const longitude = toFiniteNumber(body.longitude);
    const providerType = String(body.providerType || 'registered').trim().toLowerCase();

    if (!shopId || !shopName || !phone || !location || !specialization || !licenseNumber) {
      return jsonError('shopId, shopName, phone, location, specialization, and licenseNumber are required', 400);
    }

    if (!GHANA_CARD_NUMBER_PATTERN.test(licenseNumber)) {
      return jsonError('Ghana Card number must use the format GHA-123456789-0', 400);
    }

    if (latitude === null || longitude === null) {
      return jsonError('Valid latitude and longitude are required', 400);
    }

    if (providerType !== 'registered' && providerType !== 'tow') {
      return jsonError('Only registered mechanic or towing shops can be created', 400);
    }

    const mechanicId = await getExistingMechanicId(body.mechanicId);
    let paystackSubaccountCode: string | null = null;
    if (bankCode && accountNumber && hasPaystackSecretKey()) {
      const subaccount = await createPaystackSubaccount({
        businessName: shopName,
        bankCode,
        accountNumber,
        percentageCharge: 0,
      });
      paystackSubaccountCode = subaccount.subaccount_code;
    }

    const shopData = {
      shopId,
      mechanicId,
      shopName,
      phone,
      location,
      specialization,
      licenseNumber,
      latitude,
      longitude,
      status: 'active',
      approvalStatus: 'pending',
      bankName: bankName || null,
      bankCode: bankCode || null,
      accountNumber: accountNumber || null,
      accountName: accountName || null,
      paystackSubaccountCode,
    };
    const savedShop = providerType === 'tow'
      ? await prisma.towShop.create({ data: shopData })
      : await prisma.mechanicShop.create({
      data: {
        ...shopData,
      },
    });

    return Response.json({ shop: toShopResponse(savedShop, providerType) }, { status: 201 });
  } catch (error: any) {
    console.error('[mechanic-shops] create failed:', error);
    if (error?.code === 'P2002') {
      return jsonError('A shop with this shop ID or license number already exists', 409);
    }

    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to register mechanic shop', 500);
  }
}

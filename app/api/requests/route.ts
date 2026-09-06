import { RequestStatus, RequestType } from '@prisma/client';

import { isDatabaseConnectionError, jsonError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notifyProviderAboutRequest } from '@/lib/push-notifications';

const toRequestResponse = (request: Awaited<ReturnType<typeof prisma.requestHistory.findMany>>[number]) => ({
  id: request.id,
  requestId: request.requestId,
  type: request.type.toLowerCase(),
  status: request.status.toLowerCase(),
  driverId: request.driverId,
  driverName: request.driverName,
  driverPhone: request.driverPhone,
  driverLocation: request.driverLocation,
  mechanicId: request.mechanicId,
  providerName: request.providerName,
  providerPhone: request.providerPhone,
  problemDescription: request.problemDescription,
  price: request.price === null ? null : Number(request.price),
  currency: request.currency,
  estimatedTime: request.estimatedTime,
  acceptedBy: request.acceptedBy,
  requestedAt: request.requestedAt.toISOString(),
  createdAt: request.createdAt.toISOString(),
  updatedAt: request.updatedAt.toISOString(),
});

const ACTIVE_TOW_REQUEST_STATUSES: RequestStatus[] = [
  RequestStatus.PENDING,
  RequestStatus.CONFIRMED,
];

const toRequestType = (value: unknown): RequestType | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (
    normalized === RequestType.SERVICE ||
    normalized === RequestType.TOW ||
    normalized === RequestType.CALL ||
    normalized === RequestType.SMS ||
    normalized === RequestType.CHAT
  ) {
    return normalized as RequestType;
  }

  return null;
};

const toRequestStatus = (value: unknown, fallback: RequestStatus): RequestStatus => {
  const normalized = String(value || '').trim().toUpperCase();
  if (
    normalized === RequestStatus.PENDING ||
    normalized === RequestStatus.CONFIRMED ||
    normalized === RequestStatus.ACCEPTED ||
    normalized === RequestStatus.DECLINED ||
    normalized === RequestStatus.CANCELLED ||
    normalized === RequestStatus.CALLED ||
    normalized === RequestStatus.MESSAGED ||
    normalized === RequestStatus.CHAT
  ) {
    return normalized as RequestStatus;
  }

  return fallback;
};

const getExistingUserId = async (value: unknown) => {
  const id = String(value || '').trim();
  if (!id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true },
  });

  return user?.id || null;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const driverId = searchParams.get('driverId')?.trim();
    const driverName = searchParams.get('driverName')?.trim();
    const mechanicId = searchParams.get('mechanicId')?.trim();
    const pendingOnly = searchParams.get('pendingOnly') === 'true';
    const providerNames = searchParams
      .getAll('providerName')
      .map((name) => name.trim())
      .filter(Boolean);

    if (!driverId && !driverName && !mechanicId && providerNames.length === 0 && !pendingOnly) {
      return jsonError('driverId, driverName, mechanicId, or providerName is required', 400);
    }

    const filters = [];
    if (driverId) {
      filters.push({ driverId });
    }
    if (driverName) {
      filters.push({ driverName });
    }
    if (mechanicId) {
      filters.push({ mechanicId });
    }
    if (providerNames.length > 0) {
      filters.push({ providerName: { in: providerNames } });
    }

    const requests = await prisma.requestHistory.findMany({
      where: {
        ...(filters.length === 0 ? {} : filters.length === 1 ? filters[0] : { OR: filters }),
        ...(pendingOnly
          ? {
              status: {
                in: [RequestStatus.PENDING, RequestStatus.CONFIRMED],
              },
            }
          : {}),
      },
      orderBy: { requestedAt: 'desc' },
    });

    return Response.json({ requests: requests.map(toRequestResponse) });
  } catch (error) {
    console.error('[requests] list failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to load requests', 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const type = toRequestType(body.type);

    if (!type) {
      return jsonError('Request type must be service, tow, call, sms, or chat', 400);
    }

    const requestId = String(body.requestId || '').trim();
    const driverName = String(body.driverName || '').trim();
    const providerName = String(body.providerName || body.mechanicName || body.serviceName || '').trim();

    if (!requestId || !driverName || !providerName) {
      return jsonError('requestId, driverName, and providerName are required', 400);
    }

    const defaultStatus =
      type === RequestType.TOW
        ? RequestStatus.CONFIRMED
        : type === RequestType.CALL
        ? RequestStatus.CALLED
        : type === RequestType.SMS
        ? RequestStatus.MESSAGED
        : type === RequestType.CHAT
        ? RequestStatus.CHAT
        : RequestStatus.PENDING;
    const [driverId, requestedMechanicId] = await Promise.all([
      getExistingUserId(body.driverId),
      getExistingUserId(body.mechanicId),
    ]);
    const registeredShop = body.shopId
      ? (await Promise.all([
          prisma.mechanicShop.findUnique({
            where: { shopId: String(body.shopId).trim() },
            select: { mechanicId: true, shopName: true },
          }),
          prisma.towShop.findUnique({
            where: { shopId: String(body.shopId).trim() },
            select: { mechanicId: true, shopName: true },
          }),
        ])).find(Boolean) || null
      : null;
    const mechanicId = requestedMechanicId || registeredShop?.mechanicId || null;
    const status = toRequestStatus(body.status, defaultStatus);

    if (type === RequestType.TOW && ACTIVE_TOW_REQUEST_STATUSES.includes(status)) {
      const activeTowRequest = await prisma.requestHistory.findFirst({
        where: {
          type: RequestType.TOW,
          status: {
            in: ACTIVE_TOW_REQUEST_STATUSES,
          },
          providerName,
          OR: [
            ...(driverId ? [{ driverId }] : []),
            { driverName },
          ],
        },
        orderBy: { requestedAt: 'desc' },
      });

      if (activeTowRequest) {
        const nextProblemDescription = String(body.problemDescription || '').trim();
        const nextDriverLocation = String(body.driverLocation || body.location || '').trim();
        const updatedTowRequest = await prisma.requestHistory.update({
          where: { id: activeTowRequest.id },
          data: {
            problemDescription: nextProblemDescription || activeTowRequest.problemDescription,
            driverLocation: nextDriverLocation || activeTowRequest.driverLocation,
            mechanicId: mechanicId || activeTowRequest.mechanicId,
            providerName: registeredShop?.shopName || activeTowRequest.providerName,
          },
        });

        return Response.json({ request: toRequestResponse(updatedTowRequest) });
      }
    }

    const savedRequest = await prisma.requestHistory.create({
      data: {
        requestId,
        type,
        status,
        driverId,
        driverName,
        driverPhone: String(body.driverPhone || '').trim() || null,
        driverLocation: String(body.driverLocation || body.location || '').trim() || null,
        mechanicId,
        providerName: registeredShop?.shopName || providerName,
        providerPhone: String(body.providerPhone || body.mechanicPhone || body.servicePhone || '').trim() || null,
        problemDescription: String(body.problemDescription || '').trim() || null,
        price: body.price === undefined || body.price === null ? null : Number(body.price),
        currency: String(body.currency || 'GHS').trim() || 'GHS',
        estimatedTime:
          body.estimatedTime === undefined || body.estimatedTime === null
            ? null
            : Number(body.estimatedTime),
        acceptedBy: String(body.acceptedBy || '').trim() || null,
      },
    });

    if (
      mechanicId &&
      (type === RequestType.SERVICE || type === RequestType.TOW) &&
      (status === RequestStatus.PENDING || status === RequestStatus.CONFIRMED)
    ) {
      notifyProviderAboutRequest({
        mechanicId,
        requestId: savedRequest.requestId,
        type: type === RequestType.TOW ? 'tow' : 'service',
        driverName: savedRequest.driverName,
        providerName: savedRequest.providerName,
      }).catch((error) => {
        console.warn('[requests] provider push notification failed:', error);
      });
    }

    return Response.json({ request: toRequestResponse(savedRequest) }, { status: 201 });
  } catch (error: any) {
    console.error('[requests] create failed:', error);
    if (error?.code === 'P2002') {
      return jsonError('A request with this ID already exists', 409);
    }

    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to save request', 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const requestId = String(body.requestId || '').trim();

    if (!requestId) {
      return jsonError('requestId is required', 400);
    }

    const status = toRequestStatus(body.status, RequestStatus.PENDING);
    const existingRequest = await prisma.requestHistory.findUnique({
      where: { requestId },
      select: { id: true, type: true, driverName: true, providerName: true },
    });

    if (!existingRequest) {
      return jsonError('Request not found', 404);
    }

    const savedRequest = await prisma.requestHistory.update({
      where: { requestId },
      data: {
        status,
        acceptedBy: String(body.acceptedBy || '').trim() || undefined,
      },
    });

    if (status === RequestStatus.CANCELLED && existingRequest.type === RequestType.TOW) {
      await prisma.requestHistory.updateMany({
        where: {
          type: RequestType.TOW,
          driverName: existingRequest.driverName,
          providerName: existingRequest.providerName,
          status: {
            in: ACTIVE_TOW_REQUEST_STATUSES,
          },
        },
        data: { status: RequestStatus.CANCELLED },
      });
    }

    return Response.json({ request: toRequestResponse(savedRequest) });
  } catch (error: any) {
    console.error('[requests] update failed:', error);
    if (error?.code === 'P2025') {
      return jsonError('Request not found', 404);
    }

    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to update request', 500);
  }
}

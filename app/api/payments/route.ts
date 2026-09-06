import { PaymentMethod, PaymentStatus } from '@prisma/client';

import { isDatabaseConnectionError, jsonError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const toPaymentResponse = (payment: Awaited<ReturnType<typeof prisma.payment.findMany>>[number]) => ({
  id: payment.id,
  paymentId: payment.paymentId,
  reference: payment.reference,
  method: payment.method.toLowerCase(),
  phoneNumber: payment.phoneNumber,
  amount: Number(payment.amount),
  currency: payment.currency,
  status: payment.status.toLowerCase(),
  releaseStatus: payment.releaseStatus,
  releasedAt: payment.releasedAt?.toISOString() || null,
  releaseNote: payment.releaseNote,
  driverId: payment.driverId,
  driverName: payment.driverName,
  mechanicId: payment.mechanicId,
  mechanicName: payment.mechanicName,
  providerName: payment.providerName,
  requestId: payment.requestId,
  provider: payment.provider,
  paymentUrl: payment.paymentUrl,
  platformFee: payment.platformFee === null ? null : Number(payment.platformFee),
  commissionAmount: payment.commissionAmount === null ? null : Number(payment.commissionAmount),
  mechanicAmount: payment.mechanicAmount === null ? null : Number(payment.mechanicAmount),
  paidAt: payment.paidAt?.toISOString() || null,
  createdAt: payment.createdAt.toISOString(),
  updatedAt: payment.updatedAt.toISOString(),
});

const toPaymentMethod = (value: unknown): PaymentMethod => {
  const normalized = String(value || '').trim().toUpperCase();
  if (
    normalized === PaymentMethod.MTN ||
    normalized === PaymentMethod.TELECEL ||
    normalized === PaymentMethod.AIRTEL ||
    normalized === PaymentMethod.PAYSTACK ||
    normalized === PaymentMethod.CARD ||
    normalized === PaymentMethod.MOBILE_MONEY
  ) {
    return normalized as PaymentMethod;
  }

  return PaymentMethod.PAYSTACK;
};

const toPaymentStatus = (value: unknown): PaymentStatus => {
  const normalized = String(value || '').trim().toUpperCase();
  if (
    normalized === PaymentStatus.PROCESSING ||
    normalized === PaymentStatus.COMPLETED ||
    normalized === PaymentStatus.FAILED ||
    normalized === PaymentStatus.CANCELLED
  ) {
    return normalized as PaymentStatus;
  }

  return PaymentStatus.PROCESSING;
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
    const providerNames = searchParams
      .getAll('providerName')
      .map((name) => name.trim())
      .filter(Boolean);

    if (!driverId && !driverName && !mechanicId && providerNames.length === 0) {
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
      filters.push({ mechanicName: { in: providerNames } });
    }

    const payments = await prisma.payment.findMany({
      where: filters.length === 1 ? filters[0] : { OR: filters },
      orderBy: { createdAt: 'desc' },
    });

    return Response.json({ payments: payments.map(toPaymentResponse) });
  } catch (error) {
    console.error('[payments] list failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to load payments', 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const paymentId = String(body.paymentId || '').trim();
    const driverName = String(body.driverName || '').trim();
    const requestId = String(body.requestId || '').trim();

    if (!paymentId || !driverName || !requestId) {
      return jsonError('paymentId, driverName, and requestId are required', 400);
    }

    const [driverId, mechanicId] = await Promise.all([
      getExistingUserId(body.driverId),
      getExistingUserId(body.mechanicId),
    ]);
    const requestRecord = await prisma.requestHistory.findUnique({ where: { requestId } });
    if (!requestRecord) {
      return jsonError('The selected mechanic or tow request was not found', 404);
    }
    if (!driverId || requestRecord.driverId !== driverId) {
      return jsonError('The selected request does not belong to this driver', 403);
    }
    if (!['ACCEPTED', 'CONFIRMED'].includes(requestRecord.status.toString())) {
      return jsonError('Only accepted or confirmed requests can be paid', 422);
    }
    const existingPayment = await prisma.payment.findFirst({
      where: {
        requestId,
        status: { in: [PaymentStatus.PROCESSING, PaymentStatus.COMPLETED] },
      },
      select: { paymentId: true },
    });
    if (existingPayment) {
      return jsonError('A payment is already in progress or completed for this request', 409);
    }

    const savedPayment = await prisma.payment.create({
      data: {
        paymentId,
        reference: String(body.reference || '').trim() || null,
        method: toPaymentMethod(body.method),
        phoneNumber: String(body.phoneNumber || '').trim() || null,
        amount: body.amount === undefined || body.amount === null ? 0 : Number(body.amount),
        currency: String(body.currency || 'GHS').trim() || 'GHS',
        status: toPaymentStatus(body.status),
        driverId,
        driverName,
        mechanicId,
        mechanicName: String(body.mechanicName || '').trim() || null,
        providerName: String(body.providerName || body.mechanicName || '').trim() || null,
        requestId,
        provider: String(body.provider || 'Paystack').trim() || 'Paystack',
        paymentUrl: String(body.paymentUrl || '').trim() || null,
        platformFee: body.platformFee === undefined || body.platformFee === null ? null : Number(body.platformFee),
        commissionAmount:
          body.commissionAmount === undefined || body.commissionAmount === null
            ? null
            : Number(body.commissionAmount),
        mechanicAmount:
          body.mechanicAmount === undefined || body.mechanicAmount === null
            ? null
            : Number(body.mechanicAmount),
        paidAt: body.paidAt ? new Date(body.paidAt) : null,
      },
    });

    return Response.json({ payment: toPaymentResponse(savedPayment) }, { status: 201 });
  } catch (error: any) {
    console.error('[payments] create failed:', error);
    if (error?.code === 'P2002') {
      return jsonError('A payment with this ID or reference already exists', 409);
    }

    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError('Unable to save payment', 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const paymentId = String(body.paymentId || '').trim();
    const driverId = String(body.driverId || '').trim();

    if (!paymentId || !driverId) {
      return jsonError('paymentId and driverId are required', 400);
    }

    const payment = await prisma.payment.findFirst({
      where: {
        OR: [{ paymentId }, { reference: paymentId }],
      },
    });
    if (!payment) {
      return jsonError('Payment not found', 404);
    }
    if (payment.driverId !== driverId) {
      return jsonError('This payment does not belong to the driver', 403);
    }
    if (payment.status !== PaymentStatus.PROCESSING) {
      return jsonError('Only processing payments can be cancelled', 409);
    }

    const cancelledPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.CANCELLED },
    });
    return Response.json({ payment: toPaymentResponse(cancelledPayment) });
  } catch (error) {
    console.error('[payments] cancel failed:', error);
    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend.', 503);
    }
    return jsonError('Unable to cancel payment', 500);
  }
}

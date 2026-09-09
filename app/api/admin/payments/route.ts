import { isDatabaseConnectionError, jsonError, requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const RELEASE_STATUSES = new Set(['pending', 'released', 'rejected']);

type PaymentRecord =
  Awaited<ReturnType<typeof prisma.payment.findMany>>[number];

type RequestRecord =
  Awaited<ReturnType<typeof prisma.requestHistory.findMany>>[number];

const toPaymentResponse = (
  payment: PaymentRecord,
  serviceStatus: string | null
) => ({
  id: payment.id,
  paymentId: payment.paymentId,
  reference: payment.reference,
  method: payment.method.toLowerCase(),
  amount: Number(payment.amount),
  currency: payment.currency,
  status: payment.status.toLowerCase(),
  releaseStatus: payment.releaseStatus,
  releasedAt: payment.releasedAt?.toISOString() || null,
  releaseNote: payment.releaseNote,
  driverName: payment.driverName,
  mechanicId: payment.mechanicId,
  mechanicName: payment.mechanicName,
  providerName: payment.providerName,
  requestId: payment.requestId,
  serviceStatus,
  canRelease:
    payment.status.toString().toLowerCase() === 'completed' &&
    serviceStatus?.toLowerCase() === 'accepted',
  paidAt: payment.paidAt?.toISOString() || null,
  createdAt: payment.createdAt.toISOString(),
  updatedAt: payment.updatedAt.toISOString(),
});

export async function GET(request: Request) {
  try {
    if (!(await requireAdmin(request))) {
      return jsonError('Admin access required', 403);
    }

    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const requestIds = payments
      .map((payment: PaymentRecord) => payment.requestId)
      .filter((id): id is string => Boolean(id));

    const requests = await prisma.requestHistory.findMany({
      where: { requestId: { in: requestIds } },
      select: { requestId: true, status: true },
    });

    const serviceStatuses = new Map(
      requests.map((item) => [
        item.requestId,
        item.status,
      ])
    );

    return Response.json({
      payments: payments.map((payment: PaymentRecord) =>
        toPaymentResponse(
          payment,
          payment.requestId
            ? serviceStatuses.get(payment.requestId)?.toString() || null
            : null
        )
      ),
    });
  } catch (error) {
    console.error('[admin/payments] list failed:', error);

    if ((error as { code?: string })?.code === 'P2022') {
      return jsonError(
        'Payment approval fields are missing. Run Prisma db push and restart the backend.',
        503
      );
    }

    if (isDatabaseConnectionError(error)) {
      return jsonError(
        'Database is unreachable from the local backend.',
        503
      );
    }

    return jsonError('Unable to load payment approvals', 500);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!(await requireAdmin(request))) {
      return jsonError('Admin access required', 403);
    }

    const body = await request.json();

    const paymentId = String(body.paymentId || '').trim();

    const releaseStatus = String(body.releaseStatus || '')
      .trim()
      .toLowerCase();

    const releaseNote =
      typeof body.releaseNote === 'string'
        ? body.releaseNote.trim()
        : null;

    if (!paymentId || !RELEASE_STATUSES.has(releaseStatus)) {
      return jsonError(
        'paymentId and a valid release status are required',
        400
      );
    }

    const payment = await prisma.payment.findUnique({
      where: { paymentId },
    });

    if (!payment) {
      return jsonError('Payment not found', 404);
    }

    let serviceStatus: string | null = null;

    if (payment.requestId) {
      const serviceRequest =
        await prisma.requestHistory.findUnique({
          where: { requestId: payment.requestId },
          select: { status: true },
        });

      serviceStatus =
        serviceRequest?.status?.toString() || null;
    }

    if (
      releaseStatus === 'released' &&
      (
        payment.status.toString().toLowerCase() !== 'completed' ||
        serviceStatus?.toLowerCase() !== 'accepted'
      )
    ) {
      return jsonError(
        'Payment can be released only after successful payment and service delivery',
        422
      );
    }

    const savedPayment = await prisma.payment.update({
      where: { paymentId },
      data: {
        releaseStatus,
        releasedAt:
          releaseStatus === 'released'
            ? new Date()
            : null,
        releaseNote: releaseNote || null,
      },
    });

    return Response.json({
      payment: toPaymentResponse(
        savedPayment,
        serviceStatus
      ),
    });
  } catch (error: any) {
    console.error(
      '[admin/payments] update failed:',
      error
    );

    if (error?.code === 'P2025') {
      return jsonError('Payment not found', 404);
    }

    if (isDatabaseConnectionError(error)) {
      return jsonError(
        'Database is unreachable from the local backend.',
        503
      );
    }

    if (error?.code === 'P2022') {
      return jsonError(
        'Payment release fields are missing from the database. Restart the backend after running Prisma db push.',
        503
      );
    }

    return jsonError(
      'Unable to update payment release status',
      500
    );
  }
}
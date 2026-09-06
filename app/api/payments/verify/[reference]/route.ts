import { PaymentStatus } from '@prisma/client';

import { isDatabaseConnectionError, jsonError } from '@/lib/auth';
import { verifyPaystackTransaction } from '@/lib/paystack';
import { prisma } from '@/lib/prisma';

type RouteContext = {
  params: Promise<{ reference: string }>;
};

const toPaymentResponse = (payment: Awaited<ReturnType<typeof prisma.payment.findUnique>>) =>
  payment
    ? {
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
      }
    : null;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { reference } = await context.params;
    const cleanReference = String(reference || '').trim();
    if (!cleanReference) {
      return jsonError('reference is required', 400);
    }

    const verification = await verifyPaystackTransaction(cleanReference);
    const isSuccessful = verification.status === 'success';
    const savedPayment = await prisma.payment.update({
      where: { reference: cleanReference },
      data: {
        status: isSuccessful ? PaymentStatus.COMPLETED : PaymentStatus.FAILED,
        paidAt: isSuccessful
          ? verification.paid_at
            ? new Date(verification.paid_at)
            : new Date()
          : null,
      },
    });

    return Response.json({
      ok: isSuccessful,
      payment: toPaymentResponse(savedPayment),
    });
  } catch (error: any) {
    console.error('[payments] verify failed:', error);
    if (error?.code === 'P2025') {
      return jsonError('Payment record not found', 404);
    }

    if (isDatabaseConnectionError(error)) {
      return jsonError('Database is unreachable from the local backend. Check your network/firewall or try a hotspot.', 503);
    }

    return jsonError(error instanceof Error ? error.message : 'Unable to verify payment', 500);
  }
}

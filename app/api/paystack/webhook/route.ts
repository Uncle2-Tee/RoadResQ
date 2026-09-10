import crypto from 'crypto';

import { PaymentStatus } from '@/generated/prisma/client';

import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature') || '';
  const secret = process.env.PAYSTACK_SECRET_KEY || '';

  if (!secret) {
    return Response.json({ error: 'PAYSTACK_SECRET_KEY is not configured' }, { status: 500 });
  }

  const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  if (hash !== signature) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  if (event.event === 'charge.success') {
    const reference = String(event.data?.reference || '').trim();
    if (reference) {
      await prisma.payment.updateMany({
        where: { reference },
        data: {
          status: PaymentStatus.COMPLETED,
          paidAt: event.data?.paid_at ? new Date(event.data.paid_at) : new Date(),
        },
      });
    }
  }

  return Response.json({ received: true });
}

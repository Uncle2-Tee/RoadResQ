import {
  isDatabaseConnectionError,
  jsonError,
} from '@/lib/auth';
import { initializePaystackTransaction } from '@/lib/paystack';
import { prisma } from '@/lib/prisma';

const PLATFORM_FEE_GHS = Number(
  process.env.PLATFORM_FEE_GHS || 5
);

const COMMISSION_RATE = Number(
  process.env.PLATFORM_COMMISSION_RATE || 0.1
);

const PAYMENT_PROCESSING = 'PROCESSING';
const PAYMENT_COMPLETED = 'COMPLETED';
const PAYMENT_CANCELLED = 'CANCELLED';

const toPesewas = (amount: number) =>
  Math.round(amount * 100);

const toAmount = (value: unknown) => {
  const normalized =
    typeof value === 'string'
      ? value.replace(/,/g, '').trim()
      : value;

  const amount = Number(normalized);

  return Number.isFinite(amount)
    ? amount
    : 0;
};

type PaymentRecord =
  Awaited<
    ReturnType<typeof prisma.payment.findUnique>
  >;

const toPaymentResponse = (
  payment: PaymentRecord
) =>
  payment
    ? {
        id: payment.id,
        paymentId: payment.paymentId,
        reference: payment.reference,
        method: payment.method.toLowerCase(),
        phoneNumber: payment.phoneNumber,
        amount: Number(payment.amount),
        currency: payment.currency,
        status: payment.status
          .toString()
          .toLowerCase(),
        releaseStatus:
          payment.releaseStatus,
        releasedAt:
          payment.releasedAt?.toISOString() ||
          null,
        releaseNote:
          payment.releaseNote,
        driverId: payment.driverId,
        driverName:
          payment.driverName,
        mechanicId:
          payment.mechanicId,
        mechanicName:
          payment.mechanicName,
        providerName:
          payment.providerName,
        requestId:
          payment.requestId,
        provider:
          payment.provider,
        paymentUrl:
          payment.paymentUrl,
        platformFee:
          payment.platformFee === null
            ? null
            : Number(payment.platformFee),
        commissionAmount:
          payment.commissionAmount === null
            ? null
            : Number(
                payment.commissionAmount
              ),
        mechanicAmount:
          payment.mechanicAmount === null
            ? null
            : Number(
                payment.mechanicAmount
              ),
        paidAt:
          payment.paidAt?.toISOString() ||
          null,
        createdAt:
          payment.createdAt.toISOString(),
        updatedAt:
          payment.updatedAt.toISOString(),
      }
    : null;

const getExistingUser = async (
  value: unknown
) => {
  const id = String(value || '').trim();

  if (!id) {
    return null;
  }

  return prisma.user.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
      email: true,
      name: true,
      phoneNumber: true,
    },
  });
};

export async function POST(
  request: Request
) {
  try {
    const body = await request.json();

    const driverName = String(
      body.driverName || ''
    ).trim();

    const driverEmail = String(
      body.driverEmail || ''
    ).trim();

    const requestedAmount = toAmount(
      body.amount
    );

    const requestId = String(
      body.requestId || ''
    ).trim();

    if (!driverName) {
      return jsonError(
        'driverName is required',
        400
      );
    }

    if (!requestId) {
      return jsonError(
        'requestId is required to initialize payment',
        400
      );
    }

    const driver =
      await getExistingUser(
        body.driverId
      );

    if (!driver) {
      return jsonError(
        'A valid driver account is required before checkout',
        400
      );
    }

    const paymentEmail =
      driver.email || driverEmail;

    if (!paymentEmail) {
      return jsonError(
        'A driver email is required before checkout',
        400
      );
    }

    const requestRecord =
      await prisma.requestHistory.findUnique(
        {
          where: {
            requestId,
          },
        }
      );

    if (!requestRecord) {
      return jsonError(
        'The selected mechanic or tow request was not found',
        404
      );
    }

    if (
      requestRecord.driverId !==
      driver.id
    ) {
      return jsonError(
        'The selected request does not belong to this driver',
        403
      );
    }

    if (
      !['ACCEPTED', 'CONFIRMED'].includes(
        requestRecord.status
          .toString()
          .toUpperCase()
      )
    ) {
      return jsonError(
        'Only accepted or confirmed requests can be paid',
        422
      );
    }

    const requestAmount = toAmount(
      requestRecord.price
    );

    const jobAmount =
      requestAmount > 0 ||
      requestRecord.type
        .toString()
        .toUpperCase() !== 'SERVICE'
        ? requestAmount
        : requestedAmount;

    if (
      !Number.isFinite(jobAmount) ||
      jobAmount <= 0
    ) {
      return jsonError(
        'A valid payment amount is required before checkout',
        400
      );
    }

    const platformFee =
      PLATFORM_FEE_GHS +
      jobAmount * COMMISSION_RATE;

    const totalDriverPays =
      jobAmount + PLATFORM_FEE_GHS;

    const mechanicAmount = Math.max(
      totalDriverPays - platformFee,
      0
    );

    const reference = `BA-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;

    /*
     * Define the shop result type before using it.
     */
    type ShopMatch =
      | Awaited<
          ReturnType<
            typeof prisma.mechanicShop.findFirst
          >
        >
      | Awaited<
          ReturnType<
            typeof prisma.towShop.findFirst
          >
        >;

    /*
     * Get possible mechanic/tow shops.
     */
    const shopMatches: ShopMatch[] =
      requestRecord.mechanicId
        ? await Promise.all([
            prisma.mechanicShop.findFirst({
              where: {
                mechanicId:
                  requestRecord.mechanicId,
              },
              orderBy: {
                updatedAt: 'desc',
              },
            }),

            prisma.towShop.findFirst({
              where: {
                mechanicId:
                  requestRecord.mechanicId,
              },
              orderBy: {
                updatedAt: 'desc',
              },
            }),
          ])
        : requestRecord.providerName
          ? await Promise.all([
              prisma.mechanicShop.findFirst({
                where: {
                  shopName:
                    requestRecord.providerName,
                },
                orderBy: {
                  updatedAt: 'desc',
                },
              }),

            prisma.towShop.findFirst({
                where: {
                  shopName:
                    requestRecord.providerName,
                },
                orderBy: {
                  updatedAt: 'desc',
                },
              }),
            ])
          : [];

    /*
     * Remove null shops and select the
     * most recently updated shop.
     */
    const mechanicShop =
      shopMatches
        .filter(
          (
            shop: ShopMatch
          ): shop is NonNullable<ShopMatch> =>
            shop !== null
        )
        .sort(
          (
            left: NonNullable<ShopMatch>,
            right: NonNullable<ShopMatch>
          ) => {
            return (
              right.updatedAt.getTime() -
              left.updatedAt.getTime()
            );
          }
        )[0] || null;

    const {
      checkout,
      savedPayment,
    } = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${requestId})
          )
        `;

        await tx.payment.updateMany({
          where: {
            requestId,
            status:
              PAYMENT_PROCESSING,
            updatedAt: {
              lt: new Date(
                Date.now() -
                  60 * 1000
              ),
            },
          },
          data: {
            status:
              PAYMENT_CANCELLED,
          },
        });

        const existingPayment =
          await tx.payment.findFirst({
            where: {
              requestId,
              status: {
                in: [
                  PAYMENT_PROCESSING,
                  PAYMENT_COMPLETED,
                ],
              },
            },
            select: {
              paymentId: true,
            },
          });

        if (existingPayment) {
          throw new Error(
            'PAYMENT_ALREADY_EXISTS'
          );
        }

        const checkout =
          await initializePaystackTransaction(
            {
              email: paymentEmail,

              amountPesewas:
                toPesewas(
                  totalDriverPays
                ),

              currency:
                requestRecord.currency ||
                'GHS',

              reference,

              callbackUrl:
                process.env
                  .PAYSTACK_CALLBACK_URL,

              subaccount:
                mechanicShop
                  ?.paystackSubaccountCode,

              transactionChargePesewas:
                toPesewas(
                  platformFee
                ),

              metadata: {
                requestId,

                driverId:
                  driver.id,

                driverName,

                mechanicId:
                  requestRecord.mechanicId ||
                  null,

                providerName:
                  requestRecord.providerName ||
                  mechanicShop?.shopName ||
                  null,

                platformFee,

                commissionAmount:
                  jobAmount *
                  COMMISSION_RATE,

                mechanicAmount,
              },
            }
          );

        const savedPayment =
          await tx.payment.create({
            data: {
              paymentId:
                reference,

              reference,

              method:
                'PAYSTACK',

              phoneNumber:
                String(
                  body.phoneNumber ||
                    driver.phoneNumber ||
                    requestRecord.driverPhone ||
                    ''
                ).trim() || null,

              amount:
                totalDriverPays,

              currency:
                requestRecord.currency ||
                'GHS',

              status:
                PAYMENT_PROCESSING,

              releaseStatus:
                'pending',

              driverId:
                driver.id,

              driverName,

              mechanicId:
                requestRecord.mechanicId ||
                null,

              mechanicName:
                requestRecord.providerName ||
                mechanicShop?.shopName ||
                null,

              providerName:
                requestRecord.providerName ||
                mechanicShop?.shopName ||
                null,

              requestId,

              provider:
                'Paystack',

              paymentUrl:
                checkout.authorization_url,

              platformFee,

              commissionAmount:
                jobAmount *
                COMMISSION_RATE,

              mechanicAmount,
            },
          });

        return {
          checkout,
          savedPayment,
        };
      }
    );

    return Response.json({
      authorizationUrl:
        checkout.authorization_url,

      accessCode:
        checkout.access_code,

      reference,

      payment:
        toPaymentResponse(
          savedPayment
        ),

      breakdown: {
        jobAmount,

        bookingFee:
          PLATFORM_FEE_GHS,

        commissionAmount:
          jobAmount *
          COMMISSION_RATE,

        platformFee,

        mechanicAmount,

        totalDriverPays,
      },
    });
  } catch (error) {
    console.error(
      '[payments] initialize failed:',
      error
    );

    if (
      error instanceof Error &&
      error.message ===
        'PAYMENT_ALREADY_EXISTS'
    ) {
      return jsonError(
        'A payment is already in progress or completed for this request',
        409
      );
    }

    if (
      isDatabaseConnectionError(error)
    ) {
      return jsonError(
        'Database is unreachable from the local backend. Check your network/firewall or try a hotspot.',
        503
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Unable to initialize payment';

    return jsonError(
      message,
      message.includes(
        'PAYSTACK_SECRET_KEY'
      )
        ? 500
        : 400
    );
  }
}
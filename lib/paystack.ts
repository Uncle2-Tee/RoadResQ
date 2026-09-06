const PAYSTACK_API_BASE_URL = 'https://api.paystack.co';

export type PaystackInitializeResponse = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackVerifyResponse = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

const getPaystackSecretKey = () => process.env.PAYSTACK_SECRET_KEY?.trim();

export const hasPaystackSecretKey = () => Boolean(getPaystackSecretKey());

async function paystackRequest<T>(path: string, options: RequestInit = {}) {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured.');
  }

  const response = await fetch(`${PAYSTACK_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.status === false) {
    throw new Error(result.message || `Paystack request failed with ${response.status}`);
  }

  return result.data as T;
}

export async function createPaystackSubaccount(data: {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  percentageCharge: number;
}) {
  return paystackRequest<{ subaccount_code: string }>('/subaccount', {
    method: 'POST',
    body: JSON.stringify({
      business_name: data.businessName,
      settlement_bank: data.bankCode,
      account_number: data.accountNumber,
      percentage_charge: data.percentageCharge,
    }),
  });
}

export async function initializePaystackTransaction(data: {
  email: string;
  amountPesewas: number;
  currency: string;
  reference: string;
  callbackUrl?: string;
  subaccount?: string | null;
  transactionChargePesewas?: number;
  metadata?: Record<string, unknown>;
}) {
  return paystackRequest<PaystackInitializeResponse>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: data.email,
      amount: data.amountPesewas,
      currency: data.currency,
      reference: data.reference,
      callback_url: data.callbackUrl,
      subaccount: data.subaccount || undefined,
      transaction_charge: data.transactionChargePesewas,
      metadata: data.metadata,
    }),
  });
}

export async function verifyPaystackTransaction(reference: string) {
  return paystackRequest<PaystackVerifyResponse>(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createRequestHistory,
  cancelPayment,
  getPaymentRecords,
  initializePayment,
  getRequestHistory,
  type PaymentRecordItem,
  type RequestHistoryItem,
  verifyPayment,
} from './api-client';

const PAYMENT_RECORDS_KEY = 'paymentRecords';
const DRIVER_NAME_KEY = 'driverName';
const DRIVER_PHONE_KEY = 'driverPhone';
const USER_ID_KEY = 'userId';
const CURRENT_USER_EMAIL_KEY = 'currentUserEmail';
const TOW_REQUESTS_STORAGE_KEY = 'towRequests';
const SERVICE_REQUESTS_STORAGE_KEY = 'serviceRequests';

const payableStatuses = new Set(['accepted', 'confirmed']);

type LocalTowRequest = {
  id: string;
  serviceName: string;
  servicePhone?: string;
  driverName: string;
  location?: string;
  price?: number;
  currency?: string;
  status: string;
  mechanicId?: string;
  shopId?: string;
  timestamp?: string;
};

type LocalServiceRequest = {
  id: string;
  mechanicId?: string;
  mechanicName: string;
  mechanicPhone?: string;
  driverName: string;
  driverPhone?: string;
  driverLocation?: string;
  problemDescription?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

const appendUniquePaymentRecord = async (record: PaymentRecordItem) => {
  const existingJson = await AsyncStorage.getItem(PAYMENT_RECORDS_KEY);
  const existingRecords: PaymentRecordItem[] = existingJson ? JSON.parse(existingJson) : [];
  const nextRecords = [
    ...existingRecords.filter((existingRecord) => existingRecord.paymentId !== record.paymentId),
    record,
  ];

  await AsyncStorage.setItem(PAYMENT_RECORDS_KEY, JSON.stringify(nextRecords));
};

const findPayableRequests = async (driverId: string | null, driverName: string) => {
  const [requests, payments] = await Promise.all([
    getRequestHistory({
      driverId,
      driverName,
      forceRefresh: true,
    }).catch(() => [] as RequestHistoryItem[]),
    getPaymentRecords({ driverId, driverName, forceRefresh: true }).catch(() => [] as PaymentRecordItem[]),
  ]);
  const completedRequestIds = new Set(
    payments
      .filter((payment) => payment.status.toLowerCase() === 'completed')
      .map((payment) => payment.requestId)
      .filter((requestId): requestId is string => Boolean(requestId))
  );

  const remoteRequests = requests
    .filter((request) => !completedRequestIds.has(request.requestId))
    .filter((request) => payableStatuses.has(request.status.toLowerCase()) && (Number(request.price) > 0 || request.type === 'service'))
    .sort((a, b) => new Date(b.updatedAt || b.requestedAt).getTime() - new Date(a.updatedAt || a.requestedAt).getTime());

  const [localTowJson, localServiceJson] = await Promise.all([
    AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY),
    AsyncStorage.getItem(SERVICE_REQUESTS_STORAGE_KEY),
  ]);
  const localTows: LocalTowRequest[] = localTowJson ? JSON.parse(localTowJson) : [];
  const localServices: LocalServiceRequest[] = localServiceJson ? JSON.parse(localServiceJson) : [];
  const localRequests = [
    ...localTows
    .filter((request) => request.driverName === driverName && !completedRequestIds.has(request.id))
    .filter((request) => payableStatuses.has(request.status.toLowerCase()) && Number(request.price) > 0)
    .map((request) => ({
      id: request.id,
      requestId: request.id,
      type: 'tow' as const,
      status: request.status.toLowerCase() as RequestHistoryItem['status'],
      driverId,
      driverName: request.driverName,
      driverPhone: null,
      driverLocation: request.location || null,
      mechanicId: request.mechanicId || null,
      providerName: request.serviceName,
      providerPhone: request.servicePhone || null,
      price: Number(request.price),
      currency: request.currency || 'GHS',
      requestedAt: request.timestamp || new Date().toISOString(),
      createdAt: request.timestamp || new Date().toISOString(),
      updatedAt: request.timestamp || new Date().toISOString(),
    })),
    ...localServices
      .filter((request) => request.driverName === driverName && !completedRequestIds.has(request.id))
      .filter((request) => payableStatuses.has(request.status.toLowerCase()))
      .map((request) => ({
        id: request.id,
        requestId: request.id,
        type: 'service' as const,
        status: request.status.toLowerCase() as RequestHistoryItem['status'],
        driverId,
        driverName: request.driverName,
        driverPhone: request.driverPhone || null,
        driverLocation: request.driverLocation || null,
        mechanicId: request.mechanicId || null,
        providerName: request.mechanicName,
        providerPhone: request.mechanicPhone || null,
        price: null,
        currency: 'GHS',
        problemDescription: request.problemDescription || null,
        requestedAt: request.createdAt || new Date().toISOString(),
        createdAt: request.createdAt || new Date().toISOString(),
        updatedAt: request.updatedAt || request.createdAt || new Date().toISOString(),
      })),
  ];

  const merged = new Map([...remoteRequests, ...localRequests].map((request) => [request.requestId, request]));
  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.updatedAt || b.requestedAt).getTime() - new Date(a.updatedAt || a.requestedAt).getTime()
  );
};

export async function getPayableRequests() {
  const [driverNameValue, driverId] = await Promise.all([
    AsyncStorage.getItem(DRIVER_NAME_KEY),
    AsyncStorage.getItem(USER_ID_KEY),
  ]);
  return findPayableRequests(driverId, driverNameValue || 'Driver');
}

export async function startPaystackCheckout(requestId: string, amount?: number | string) {
  const [driverNameValue, driverPhoneValue, driverId, driverEmail] = await Promise.all([
    AsyncStorage.getItem(DRIVER_NAME_KEY),
    AsyncStorage.getItem(DRIVER_PHONE_KEY),
    AsyncStorage.getItem(USER_ID_KEY),
    AsyncStorage.getItem(CURRENT_USER_EMAIL_KEY),
  ]);
  const driverName = driverNameValue || 'Driver';
  const selectedRequest = (await findPayableRequests(driverId, driverName))
    .find((request) => request.requestId === requestId);

  if (!selectedRequest) {
    throw new Error('Select a valid accepted mechanic or tow request before proceeding to payment.');
  }
  const requestAmount = Number(selectedRequest.price);
  const requestedAmount = Number(String(amount ?? '').replace(/,/g, '').trim());
  const checkoutAmount = requestAmount > 0 ? requestAmount : requestedAmount;
  if (!Number.isFinite(checkoutAmount) || checkoutAmount <= 0) {
    throw new Error('Enter a valid service amount before proceeding to payment.');
  }

  const remoteRequests = await getRequestHistory({
    driverId,
    driverName,
    forceRefresh: true,
  }).catch(() => [] as RequestHistoryItem[]);
  if (!remoteRequests.some((request) => request.requestId === selectedRequest.requestId)) {
    await createRequestHistory({
      requestId: selectedRequest.requestId,
      type: selectedRequest.type,
      status: selectedRequest.status,
      driverId,
      driverName: selectedRequest.driverName,
      driverPhone: selectedRequest.driverPhone,
      driverLocation: selectedRequest.driverLocation,
      mechanicId: selectedRequest.mechanicId,
      providerName: selectedRequest.providerName,
      providerPhone: selectedRequest.providerPhone,
      price: checkoutAmount,
      currency: selectedRequest.currency,
    }).catch(() => undefined);
  }

  const checkout = await initializePayment({
    driverId,
    driverName,
    driverEmail,
    phoneNumber: driverPhoneValue || selectedRequest.driverPhone || null,
    requestId: selectedRequest.requestId,
    amount: checkoutAmount,
    currency: selectedRequest.currency || 'GHS',
  });

  await appendUniquePaymentRecord(checkout.payment);
  return checkout;
}

export async function verifyPaystackCheckout(reference: string) {
  const result = await verifyPayment(reference);
  await appendUniquePaymentRecord(result.payment);
  return result;
}

export async function cancelPaystackCheckout(reference: string) {
  const driverId = await AsyncStorage.getItem(USER_ID_KEY);
  if (!driverId) {
    throw new Error('Driver session is missing. Please sign in again.');
  }
  return cancelPayment(reference, driverId);
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createRequestHistory, type CreateRequestHistoryData } from './api-client';
import { touchRequestOverview } from './request-sync';

const DRIVER_PHONE_KEY = 'driverPhone';
const USER_ID_KEY = 'userId';
const CONTACT_REQUESTS_STORAGE_KEY = 'contactRequests';
const TOW_REQUESTS_STORAGE_KEY = 'towRequests';

type ContactRequestType = 'sms' | 'chat';

type ContactStatus = 'messaged' | 'chat';

type ContactProvider = {
  id?: string;
  mechanicId?: string | null;
  name: string;
  phone: string;
  location?: string;
};

type ContactRecord = {
  id: string;
  type: ContactRequestType;
  serviceName: string;
  servicePhone: string;
  mechanicId?: string;
  driverName: string;
  driverPhone?: string;
  location: string;
  problemDescription?: string;
  timestamp: string;
  status: ContactStatus;
};

type TowRecord = {
  id: string;
  type: 'tow';
  shopId?: string;
  mechanicId?: string;
  serviceName: string;
  servicePhone: string;
  driverName: string;
  location: string;
  problemDescription?: string;
  price: number;
  currency: string;
  estimatedTime: number;
  timestamp: string;
  status: string;
};

const activeTowRequestStatuses = new Set(['pending', 'confirmed']);

const contactStatusByType: Record<ContactRequestType, ContactStatus> = {
  sms: 'messaged',
  chat: 'chat',
};

const contactIssueByType: Record<ContactRequestType, string> = {
  sms: 'No SMS message provided',
  chat: 'Driver opened chat with mechanic',
};

const requestPrefixByType: Record<ContactRequestType, string> = {
  sms: 'SMS',
  chat: 'CHAT',
};

const getDriverIdentifiers = async () => {
  const [driverPhone, driverId] = await Promise.all([
    AsyncStorage.getItem(DRIVER_PHONE_KEY),
    AsyncStorage.getItem(USER_ID_KEY),
  ]);

  return {
    driverPhone: driverPhone || undefined,
    driverId,
  };
};

const appendUniqueRecord = async <T extends { id: string }>(storageKey: string, record: T) => {
  const existingJson = await AsyncStorage.getItem(storageKey);
  const existingRecords: T[] = existingJson ? JSON.parse(existingJson) : [];
  const nextRecords = [
    ...existingRecords.filter((existingRecord) => existingRecord.id !== record.id),
    record,
  ];
  await AsyncStorage.setItem(storageKey, JSON.stringify(nextRecords));
};

const normalizeIdentityPart = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getTowRequestIdentity = ({
  driverName,
  serviceId,
  serviceName,
}: {
  driverName: string;
  serviceId?: string;
  serviceName: string;
}) => `${normalizeIdentityPart(driverName)}:${normalizeIdentityPart(serviceId || serviceName)}`;

const syncRequestHistoryInBackground = (data: CreateRequestHistoryData) => {
  createRequestHistory(data)
    .then(() => touchRequestOverview())
    .catch((error) => {
      console.warn('Unable to sync request history in the background:', error);
    });
};

export async function recordMechanicContactRequest({
  type,
  provider,
  driverName,
  driverLocation,
  problemDescription,
}: {
  type: ContactRequestType;
  provider: ContactProvider;
  driverName: string;
  driverLocation?: string;
  problemDescription?: string;
}) {
  const { driverPhone, driverId } = await getDriverIdentifiers();
  const requestId = `${requestPrefixByType[type]}-${Date.now()}`;
  const timestamp = new Date().toISOString();
  const location = driverLocation?.trim() || 'Location not provided';
  const status = contactStatusByType[type];
  const providerOwnerId = provider.mechanicId || provider.id;
  const issue = problemDescription?.trim() || contactIssueByType[type];

  await appendUniqueRecord<ContactRecord>(CONTACT_REQUESTS_STORAGE_KEY, {
    id: requestId,
    type,
    serviceName: provider.name,
    servicePhone: provider.phone,
    mechanicId: providerOwnerId,
    driverName,
    driverPhone,
    location,
    problemDescription: issue,
    timestamp,
    status,
  });

  syncRequestHistoryInBackground({
    requestId,
    type,
    status,
    driverId,
    driverName,
    driverPhone,
    driverLocation: location,
    mechanicId: providerOwnerId,
    providerName: provider.name,
    providerPhone: provider.phone,
    problemDescription: issue,
  });
  await touchRequestOverview();
}

export async function recordTowRequest({
  service,
  driverName,
  driverLocation,
  problemDescription,
}: {
  service: {
    id?: string;
    mechanicId?: string | null;
    name: string;
    phone: string;
    price?: number;
    estimatedTime?: number;
  };
  driverName: string;
  driverLocation?: string;
  problemDescription?: string;
}) {
  const { driverPhone, driverId } = await getDriverIdentifiers();
  const timestamp = new Date().toISOString();
  const location = driverLocation || 'Location not provided';
  const shopId = service.id;
  const providerOwnerId = service.mechanicId || undefined;
  const requestIdentity = getTowRequestIdentity({
    driverName,
    serviceId: shopId,
    serviceName: service.name,
  });
  const existingTowRequestsJson = await AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY);
  const existingTowRequests: TowRecord[] = existingTowRequestsJson ? JSON.parse(existingTowRequestsJson) : [];
  const existingActiveRequest = existingTowRequests.find((request) => {
    const existingIdentity = getTowRequestIdentity({
      driverName: request.driverName,
      serviceId: request.shopId || request.mechanicId,
      serviceName: request.serviceName,
    });

    return existingIdentity === requestIdentity && activeTowRequestStatuses.has((request.status || '').toLowerCase());
  });

  if (existingActiveRequest) {
    const updatedActiveRequest: TowRecord = {
      ...existingActiveRequest,
      location,
      problemDescription:
        problemDescription?.trim() ||
        existingActiveRequest.problemDescription ||
        'No issue description provided',
    };

    await appendUniqueRecord<TowRecord>(TOW_REQUESTS_STORAGE_KEY, updatedActiveRequest);
    await touchRequestOverview();
    syncRequestHistoryInBackground({
      requestId: updatedActiveRequest.id,
      type: 'tow',
        shopId: updatedActiveRequest.shopId,
      status: updatedActiveRequest.status as CreateRequestHistoryData['status'],
      driverId,
      driverName: updatedActiveRequest.driverName,
      driverPhone,
      driverLocation: updatedActiveRequest.location,
      mechanicId: updatedActiveRequest.mechanicId,
      providerName: updatedActiveRequest.serviceName,
      providerPhone: updatedActiveRequest.servicePhone,
      problemDescription: updatedActiveRequest.problemDescription,
      price: updatedActiveRequest.price || 0,
      currency: updatedActiveRequest.currency || 'GHS',
      estimatedTime: updatedActiveRequest.estimatedTime || 0,
    });
    return updatedActiveRequest;
  }

  const requestId = `TOW-${Date.now()}`;
  const towRecord: TowRecord = {
    id: requestId,
    type: 'tow',
    shopId,
    mechanicId: providerOwnerId || shopId,
    serviceName: service.name,
    servicePhone: service.phone,
    driverName,
    location,
    problemDescription: problemDescription?.trim() || 'No issue description provided',
    price: service.price || 0,
    currency: 'GHS',
    estimatedTime: service.estimatedTime || 0,
    timestamp,
    status: 'confirmed',
  };
  const requestHistoryData: CreateRequestHistoryData = {
    requestId,
    type: 'tow',
    shopId,
    status: 'confirmed',
    driverId,
    driverName,
    driverPhone,
    driverLocation: location,
    mechanicId: providerOwnerId || shopId,
    providerName: service.name,
    providerPhone: service.phone,
    problemDescription: problemDescription?.trim() || 'No issue description provided',
    price: service.price || 0,
    currency: 'GHS',
    estimatedTime: service.estimatedTime || 0,
  };

  await appendUniqueRecord<TowRecord>(TOW_REQUESTS_STORAGE_KEY, towRecord);
  await touchRequestOverview();
  syncRequestHistoryInBackground(requestHistoryData);
  return towRecord;
}

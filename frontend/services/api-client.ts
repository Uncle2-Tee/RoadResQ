/**
 * API client for communicating with the Breakdown Assist backend
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000';
const REQUEST_TIMEOUT_MS = 12000;
const AUTH_REQUEST_TIMEOUT_MS = 30000;
const LOGOUT_REQUEST_TIMEOUT_MS = 8000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const MECHANIC_SHOPS_CACHE_KEY = 'mechanicShopsApiCache';
const REQUEST_HISTORY_CACHE_PREFIX = 'requestHistoryApiCache:';
const REQUEST_HISTORY_CACHE_TTL_MS = 60000;
const PAYMENT_RECORDS_CACHE_PREFIX = 'paymentRecordsApiCache:';
const PAYMENT_RECORDS_CACHE_TTL_MS = 60000;
const OFFLINE_API_QUEUE_KEY = 'offlineApiQueue';
const REMOVED_LOCAL_MECHANIC_SHOP_NAMES = new Set([
  'elliot auto',
  'elliot autos',
  'elliots auto',
  'elliots autos',
  'fast fix',
  'fast fixes',
]);

const isApprovedMechanicShop = (shop: MechanicShopItem, includeInactive = false) =>
  shop.approvalStatus === 'approved' && (includeInactive || shop.status !== 'inactive');

let mechanicShopsCache: MechanicShopItem[] | null = null;
let mechanicShopsRequest: Promise<MechanicShopItem[]> | null = null;
let healthyApiBaseUrl: string | null = null;
const requestHistoryCache = new Map<string, { timestamp: number; requests: RequestHistoryItem[] }>();
const requestHistoryRequests = new Map<string, Promise<RequestHistoryItem[]>>();
const paymentRecordsCache = new Map<string, { timestamp: number; payments: PaymentRecordItem[] }>();
const paymentRecordsRequests = new Map<string, Promise<PaymentRecordItem[]>>();
const cachedFallbackWarningTimestamps = new Map<string, number>();

const logDebug = (...args: unknown[]) => {
  if (__DEV__) {
    console.log(...args);
  }
};

const warnCachedFallback = (key: string, message: string) => {
  const now = Date.now();
  const lastWarnedAt = cachedFallbackWarningTimestamps.get(key) || 0;
  if (now - lastWarnedAt < 30000) {
    return;
  }

  cachedFallbackWarningTimestamps.set(key, now);
  console.warn(message);
};

logDebug('[API Client] Initialized with base URL:', API_BASE_URL);

const getExpoHostApiBaseUrl = () => {
  const constants = Constants as typeof Constants & {
    manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
  };
  const hostUri = Constants.expoConfig?.hostUri || constants.manifest2?.extra?.expoGo?.debuggerHost;
  const host = hostUri?.split(':')[0];

  return host ? `http://${host}:3000` : null;
};

const getApiBaseCandidates = () =>
  Array.from(
    new Set([
      API_BASE_URL,
      getExpoHostApiBaseUrl(),
      'http://10.168.107.196:3000',
      'http://10.0.2.2:3000',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ].filter((candidate): candidate is string => Boolean(candidate)))
  );

interface SignupData {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  role: 'driver' | 'mechanic' | 'tower' | 'admin';
}

interface LoginData {
  email: string;
  password: string;
  forceLogin?: boolean;
}

export interface RegisterPushTokenData {
  userId: string;
  token: string;
  platform?: string | null;
  role: 'mechanic' | 'tower';
}

interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: 'driver' | 'mechanic' | 'tower';
  profilePhotoUri?: string | null;
  sessionId?: string;
  createdAt: string;
}

export interface RequestHistoryItem {
  id: string;
  requestId: string;
  type: 'service' | 'tow' | 'call' | 'sms' | 'chat';
  status: 'pending' | 'confirmed' | 'accepted' | 'declined' | 'cancelled' | 'called' | 'messaged' | 'chat';
  driverId?: string | null;
  driverName: string;
  driverPhone?: string | null;
  driverLocation?: string | null;
  mechanicId?: string | null;
  providerName: string;
  providerPhone?: string | null;
  problemDescription?: string | null;
  price?: number | null;
  currency: string;
  estimatedTime?: number | null;
  acceptedBy?: string | null;
  requestedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRequestHistoryData {
  requestId: string;
  type: 'service' | 'tow' | 'call' | 'sms' | 'chat';
  shopId?: string | null;
  status?: RequestHistoryItem['status'];
  driverId?: string | null;
  driverName: string;
  driverPhone?: string | null;
  driverLocation?: string | null;
  mechanicId?: string | null;
  providerName: string;
  providerPhone?: string | null;
  problemDescription?: string | null;
  price?: number | null;
  currency?: string;
  estimatedTime?: number | null;
  acceptedBy?: string | null;
}

export interface PaymentRecordItem {
  id: string;
  paymentId: string;
  reference?: string | null;
  method: 'mtn' | 'telecel' | 'airtel' | 'paystack' | 'card' | 'mobile_money';
  phoneNumber?: string | null;
  amount: number;
  currency: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  releaseStatus?: 'pending' | 'released' | 'rejected' | string;
  releasedAt?: string | null;
  releaseNote?: string | null;
  driverId?: string | null;
  driverName: string;
  mechanicId?: string | null;
  mechanicName?: string | null;
  providerName?: string | null;
  requestId?: string | null;
  provider?: string | null;
  paymentUrl?: string | null;
  platformFee?: number | null;
  commissionAmount?: number | null;
  mechanicAmount?: number | null;
  paidAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentRecordData {
  paymentId: string;
  reference?: string | null;
  method?: PaymentRecordItem['method'];
  phoneNumber?: string | null;
  amount?: number;
  currency?: string;
  status?: PaymentRecordItem['status'];
  driverId?: string | null;
  driverName: string;
  mechanicId?: string | null;
  mechanicName?: string | null;
  providerName?: string | null;
  requestId?: string | null;
  provider?: string | null;
  paymentUrl?: string | null;
  platformFee?: number | null;
  commissionAmount?: number | null;
  mechanicAmount?: number | null;
  paidAt?: string | null;
}

export interface InitializePaymentData {
  driverId?: string | null;
  driverName: string;
  driverEmail?: string | null;
  phoneNumber?: string | null;
  requestId?: string | null;
  amount?: number;
  currency?: string;
}

export interface InitializePaymentResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  payment: PaymentRecordItem;
  breakdown: {
    jobAmount: number;
    bookingFee: number;
    commissionAmount: number;
    platformFee: number;
    mechanicAmount: number;
    totalDriverPays: number;
  };
}

export interface MechanicShopItem {
  id: string;
  shopId: string;
  mechanicId?: string | null;
  shopName: string;
  phone: string;
  location: string;
  specialization: string;
  licenseNumber: string;
  latitude: number;
  longitude: number;
  providerType: 'registered' | 'unregistered' | string;
  status: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | string;
  bankName?: string | null;
  bankCode?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  paystackSubaccountCode?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ShopApprovalStatus = 'pending' | 'approved' | 'rejected';

export type PaymentReleaseStatus = 'pending' | 'released' | 'rejected';

export interface AdminPaymentItem extends PaymentRecordItem {
  serviceStatus: string | null;
  canRelease: boolean;
}

export async function getAdminPayments(): Promise<AdminPaymentItem[]> {
  const apiBaseUrl = await findHealthyApiBaseUrl();
  const [userId, sessionId] = await Promise.all([
    AsyncStorage.getItem('userId'),
    AsyncStorage.getItem('userSessionId'),
  ]);
  const response = await apiFetch(`${apiBaseUrl}/api/admin/payments`, {
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId || '', 'x-session-id': sessionId || '' },
  });
  const result = await parseJsonResponse<{ payments?: AdminPaymentItem[]; error?: string }>(response, 'Load admin payments');
  if (!response.ok) throw new Error(result.error || 'Unable to load admin payments');
  return result.payments || [];
}

export async function updateAdminPaymentRelease(
  paymentId: string,
  releaseStatus: PaymentReleaseStatus,
  releaseNote?: string
): Promise<AdminPaymentItem> {
  const apiBaseUrl = await findHealthyApiBaseUrl();
  const [userId, sessionId] = await Promise.all([
    AsyncStorage.getItem('userId'),
    AsyncStorage.getItem('userSessionId'),
  ]);
  const response = await apiFetch(`${apiBaseUrl}/api/admin/payments`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId || '', 'x-session-id': sessionId || '' },
    body: JSON.stringify({ paymentId, releaseStatus, releaseNote }),
  });
  const result = await parseJsonResponse<{ payment?: AdminPaymentItem; error?: string }>(response, 'Update payment release');
  if (!response.ok || !result.payment) throw new Error(result.error || 'Unable to update payment release');
  return result.payment;
}

export async function getAdminMechanicShops(): Promise<MechanicShopItem[]> {
  const apiBaseUrl = await findHealthyApiBaseUrl();
  const [userId, sessionId] = await Promise.all([
    AsyncStorage.getItem('userId'),
    AsyncStorage.getItem('userSessionId'),
  ]);
  const response = await apiFetch(`${apiBaseUrl}/api/admin/mechanic-shops`, {
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId || '',
      'x-session-id': sessionId || '',
    },
  });
  const result = await parseJsonResponse<{ shops?: MechanicShopItem[]; error?: string }>(response, 'Load admin shops');
  if (!response.ok) {
    throw new Error(result.error || 'Unable to load admin shops');
  }
  return result.shops || [];
}

export async function updateAdminMechanicShopStatus(
  shopId: string,
  status: ShopApprovalStatus,
  providerType?: string
): Promise<MechanicShopItem> {
  const apiBaseUrl = await findHealthyApiBaseUrl();
  const [userId, sessionId] = await Promise.all([
    AsyncStorage.getItem('userId'),
    AsyncStorage.getItem('userSessionId'),
  ]);
  const response = await apiFetch(`${apiBaseUrl}/api/admin/mechanic-shops`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId || '',
      'x-session-id': sessionId || '',
    },
    body: JSON.stringify({ shopId, status, providerType }),
  });
  const result = await parseJsonResponse<{ shop?: MechanicShopItem; error?: string }>(response, 'Update shop approval');
  if (!response.ok || !result.shop) {
    throw new Error(result.error || 'Unable to update shop approval');
  }
  mechanicShopsRequest = null;
  mechanicShopsCache = null;
  return result.shop;
}

export interface CreateMechanicShopData {
  shopId: string;
  mechanicId?: string | null;
  shopName: string;
  phone: string;
  location: string;
  specialization: string;
  licenseNumber: string;
  latitude: number;
  longitude: number;
  providerType?: 'registered' | 'unregistered' | string;
  status?: string;
  bankName?: string | null;
  bankCode?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
}

interface ApiResponse<T> {
  message?: string;
  user?: T;
  error?: string;
}

type OfflineApiAction =
  | { id: string; type: 'createRequestHistory'; data: CreateRequestHistoryData; createdAt: string }
  | { id: string; type: 'createPaymentRecord'; data: CreatePaymentRecordData; createdAt: string }
  | {
      id: string;
      type: 'updateRequestHistoryStatus';
      data: { requestId: string; status: RequestHistoryItem['status']; acceptedBy?: string | null };
      createdAt: string;
    }
  | { id: string; type: 'createMechanicShop'; data: CreateMechanicShopData; createdAt: string }
  | {
      id: string;
      type: 'updateMechanicShop';
      data: { shopId: string; status?: 'active' | 'inactive'; shopName?: string };
      createdAt: string;
    };

async function apiFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Please check that the backend is running and reachable.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseJsonResponse<T>(response: Response, action: string): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.trim().slice(0, 120).replace(/\s+/g, ' ');
    const contentType = response.headers.get('content-type') || '';
    const looksLikeHtml = contentType.includes('text/html') || preview.startsWith('<!DOCTYPE') || preview.startsWith('<html');

    if (looksLikeHtml) {
      throw new Error(
        `${action} returned an HTML error page from the backend instead of JSON. ` +
          `Restart the backend with "npm run dev" in BreakdownAssistApp, then reload the Expo app.`
      );
    }

    throw new Error(
      `${action} returned ${response.status} ${response.statusText || ''} instead of JSON. ` +
        `Check that EXPO_PUBLIC_API_URL points to the Next backend. Response starts with: ${preview}`
    );
  }
}

async function findHealthyApiBaseUrl() {
  if (healthyApiBaseUrl) {
    return healthyApiBaseUrl;
  }

  const candidates = getApiBaseCandidates();
  const checks = await Promise.allSettled(
    candidates.map(async (baseUrl) => {
      const response = await apiFetch(
        `${baseUrl}/api/health`,
        { method: 'GET' },
        HEALTH_CHECK_TIMEOUT_MS
      );

      if (!response.ok) {
        throw new Error(`Health check failed with ${response.status}`);
      }

      return baseUrl;
    })
  );

  const firstHealthy = checks.find(
    (check): check is PromiseFulfilledResult<string> => check.status === 'fulfilled'
  );

  if (firstHealthy) {
    healthyApiBaseUrl = firstHealthy.value;
    if (healthyApiBaseUrl !== API_BASE_URL) {
      logDebug('[API Client] Using reachable API URL:', healthyApiBaseUrl);
    }
    return healthyApiBaseUrl;
  }

  throw new Error(
    `Backend is not reachable. Start the backend with "npm run dev" in BreakdownAssistApp, then make sure EXPO_PUBLIC_API_URL points to this computer. Tried: ${candidates.join(', ')}`
  );
}

const withoutRemovedLocalMechanicShops = (shops: MechanicShopItem[]) =>
  shops.filter((shop) => !REMOVED_LOCAL_MECHANIC_SHOP_NAMES.has(normalizeShopNameForRemoval(shop.shopName)));

const normalizeShopNameForRemoval = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const setMechanicShopsLocalCache = async (shops: MechanicShopItem[]) => {
  mechanicShopsCache = withoutRemovedLocalMechanicShops(shops);
  await AsyncStorage.setItem(MECHANIC_SHOPS_CACHE_KEY, JSON.stringify(mechanicShopsCache));
  return mechanicShopsCache;
};

const getOfflineQueue = async (): Promise<OfflineApiAction[]> => {
  const json = await AsyncStorage.getItem(OFFLINE_API_QUEUE_KEY);
  return json ? (JSON.parse(json) as OfflineApiAction[]) : [];
};

const enqueueOfflineAction = async (action: Omit<OfflineApiAction, 'id' | 'createdAt'>) => {
  const queued = await getOfflineQueue();
  const nextAction = {
    ...action,
    id: `${action.type}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
  } as OfflineApiAction;

  await AsyncStorage.setItem(OFFLINE_API_QUEUE_KEY, JSON.stringify([...queued, nextAction]));
};

const sendQueuedAction = async (action: OfflineApiAction) => {
  const apiBaseUrl = await findHealthyApiBaseUrl();

  if (action.type === 'createRequestHistory') {
    const response = await apiFetch(`${apiBaseUrl}/api/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action.data),
    });
    if (!response.ok && response.status !== 409) throw new Error('Unable to sync queued request');
    return;
  }

  if (action.type === 'updateRequestHistoryStatus') {
    const response = await apiFetch(`${apiBaseUrl}/api/requests`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action.data),
    });
    if (!response.ok) throw new Error('Unable to sync queued request update');
    return;
  }

  if (action.type === 'createMechanicShop') {
    const response = await apiFetch(`${apiBaseUrl}/api/mechanic-shops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action.data),
    });
    if (!response.ok && response.status !== 409) throw new Error('Unable to sync queued mechanic shop');
    return;
  }

  if (action.type === 'createPaymentRecord') {
    const response = await apiFetch(`${apiBaseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action.data),
    });
    if (!response.ok && response.status !== 409) throw new Error('Unable to sync queued payment');
    return;
  }

  const response = await apiFetch(`${apiBaseUrl}/api/mechanic-shops`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action.data),
  });
  if (!response.ok) throw new Error('Unable to sync queued mechanic shop update');
};

export const syncOfflineChanges = async () => {
  const queued = await getOfflineQueue();
  if (queued.length === 0) {
    return 0;
  }

  const remaining: OfflineApiAction[] = [];
  let synced = 0;

  for (const action of queued) {
    try {
      await sendQueuedAction(action);
      synced += 1;
    } catch {
      remaining.push(action);
    }
  }

  if (remaining.length === 0) {
    await AsyncStorage.removeItem(OFFLINE_API_QUEUE_KEY);
  } else {
    await AsyncStorage.setItem(OFFLINE_API_QUEUE_KEY, JSON.stringify(remaining));
  }

  if (synced > 0) {
    clearRequestHistoryCache();
    mechanicShopsRequest = null;
  }

  return synced;
};

const createOfflineRequestHistoryItem = (data: CreateRequestHistoryData): RequestHistoryItem => {
  const now = new Date().toISOString();
  return {
    id: `offline-${data.requestId}`,
    requestId: data.requestId,
    type: data.type,
    status: data.status || 'pending',
    driverId: data.driverId,
    driverName: data.driverName,
    driverPhone: data.driverPhone,
    driverLocation: data.driverLocation,
    mechanicId: data.mechanicId,
    providerName: data.providerName,
    providerPhone: data.providerPhone,
    problemDescription: data.problemDescription,
    price: data.price,
    currency: data.currency || 'GHS',
    estimatedTime: data.estimatedTime,
    acceptedBy: data.acceptedBy,
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
  };
};

const createOfflineMechanicShopItem = (data: CreateMechanicShopData): MechanicShopItem => {
  const now = new Date().toISOString();
  return {
    id: `offline-${data.shopId}`,
    shopId: data.shopId,
    mechanicId: data.mechanicId,
    shopName: data.shopName,
    phone: data.phone,
    location: data.location,
    specialization: data.specialization,
    licenseNumber: data.licenseNumber,
    latitude: data.latitude,
    longitude: data.longitude,
    providerType: data.providerType || 'registered',
    status: data.status || 'active',
    bankName: data.bankName,
    bankCode: data.bankCode,
    accountNumber: data.accountNumber,
    accountName: data.accountName,
    createdAt: now,
    updatedAt: now,
  };
};

const createOfflinePaymentRecordItem = (data: CreatePaymentRecordData): PaymentRecordItem => {
  const now = new Date().toISOString();
  return {
    id: `offline-${data.paymentId}`,
    paymentId: data.paymentId,
    reference: data.reference,
    method: data.method || 'paystack',
    phoneNumber: data.phoneNumber,
    amount: data.amount || 0,
    currency: data.currency || 'GHS',
    status: data.status || 'processing',
    driverId: data.driverId,
    driverName: data.driverName,
    mechanicId: data.mechanicId,
    mechanicName: data.mechanicName,
    providerName: data.providerName,
    requestId: data.requestId,
    provider: data.provider || 'Paystack',
    paymentUrl: data.paymentUrl,
    platformFee: data.platformFee,
    commissionAmount: data.commissionAmount,
    mechanicAmount: data.mechanicAmount,
    paidAt: data.paidAt,
    createdAt: now,
    updatedAt: now,
  };
};

/**
 * Sign up a new user
 */
export async function signup(data: SignupData): Promise<User> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/auth/signup`;
    logDebug('[API] Signup request to:', url);
    
    const response = await apiFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      },
      AUTH_REQUEST_TIMEOUT_MS
    );

    const result = await parseJsonResponse<ApiResponse<User>>(response, 'Signup');
    logDebug('[API] Signup response:', { status: response.status, ok: response.ok, result });

    if (!response.ok) {
      throw new Error(result.error || result.message || 'Signup failed');
    }

    if (!result.user) {
      console.error('[API] Signup response has no user:', result);
      throw new Error('Invalid response: no user data returned');
    }

    logDebug('[API] Signup successful, user created:', result.user);
    return result.user;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.error('[API] Signup error:', message);
    throw new Error(`Signup error: ${message}`);
  }
}

/**
 * Login user with email and password
 */
export async function login(data: LoginData): Promise<User> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/auth/login`;
    logDebug('[API] Login request to:', url);
    
    const response = await apiFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      },
      AUTH_REQUEST_TIMEOUT_MS
    );

    const result = await parseJsonResponse<ApiResponse<User>>(response, 'Login');
    logDebug('[API] Login response:', { status: response.status, ok: response.ok });

    if (!response.ok) {
      throw new Error(result.error || result.message || 'Login failed');
    }

    return result.user!;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.error('[API] Login error:', message);
    throw new Error(`Login error: ${message}`);
  }
}

/**
 * Get user profile by ID
 */
export async function getUserProfile(userId: string): Promise<User> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/auth/user/${userId}`;
    logDebug('[API] Get user request to:', url);
    
    const response = await apiFetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await parseJsonResponse<ApiResponse<User>>(response, 'Get user');

    if (!response.ok) {
      throw new Error(result.error || 'Failed to fetch user');
    }

    return result.user!;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.error('[API] Get user error:', message);
    throw new Error(`Get user error: ${message}`);
  }
}

/**
 * Update user profile
 */
export async function updateUserProfile(
  userId: string,
  data: { name?: string; phone?: string; profilePhotoUri?: string | null }
): Promise<User> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/auth/user/${userId}`;
    logDebug('[API] Update user request to:', url);
    
    const response = await apiFetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await parseJsonResponse<ApiResponse<User>>(response, 'Update user');

    if (!response.ok) {
      throw new Error(result.error || 'Failed to update profile');
    }

    return result.user!;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.error('[API] Update user error:', message);
    throw new Error(`Update user error: ${message}`);
  }
}

/**
 * Check if email is available
 */
export async function checkEmailAvailability(email: string): Promise<boolean> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/auth/check-email`;
    logDebug('[API] Check email request to:', url, 'for email:', email);
    
    const response = await apiFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const result = await response.json();
    logDebug('[API] Check email response:', { status: response.status, ok: response.ok, available: result.available });

    if (!response.ok) {
      throw new Error(result.error || 'Failed to check email');
    }

    return result.available;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.error('[API] Check email error:', message);
    throw new Error(`Check email error: ${message}`);
  }
}

/**
 * Get API base URL (useful for other API calls)
 */
export function getApiBaseUrl(): string {
  return healthyApiBaseUrl || API_BASE_URL;
}

const buildRequestHistoryQuery = (params: {
  driverId?: string | null;
  driverName?: string | null;
  mechanicId?: string | null;
  providerName?: string | null;
  providerNames?: string[];
  pendingOnly?: boolean;
  forceRefresh?: boolean;
}) => {
  const query = new URLSearchParams();
  if (params.driverId) {
    query.set('driverId', params.driverId);
  }
  if (params.driverName) {
    query.set('driverName', params.driverName);
  }
  if (params.mechanicId) {
    query.set('mechanicId', params.mechanicId);
  }
  if (params.providerName) {
    query.set('providerName', params.providerName);
  }
  [...(params.providerNames || [])]
    .map((providerName) => providerName.trim())
    .filter(Boolean)
    .sort()
    .forEach((providerName) => {
      query.append('providerName', providerName);
    });
  if (params.pendingOnly) {
    query.set('pendingOnly', 'true');
  }

  return query.toString();
};

const clearRequestHistoryCache = () => {
  requestHistoryCache.clear();
  requestHistoryRequests.clear();
  AsyncStorage.getAllKeys()
    .then((keys) =>
      AsyncStorage.multiRemove(
        keys.filter((key) => key.startsWith(REQUEST_HISTORY_CACHE_PREFIX))
      )
    )
    .catch(() => {});
};

const buildPaymentRecordsQuery = (params: {
  driverId?: string | null;
  driverName?: string | null;
  mechanicId?: string | null;
  providerName?: string | null;
  providerNames?: string[];
  forceRefresh?: boolean;
}) => {
  const query = new URLSearchParams();
  if (params.driverId) {
    query.set('driverId', params.driverId);
  }
  if (params.driverName) {
    query.set('driverName', params.driverName);
  }
  if (params.mechanicId) {
    query.set('mechanicId', params.mechanicId);
  }
  if (params.providerName) {
    query.set('providerName', params.providerName);
  }
  [...(params.providerNames || [])]
    .map((providerName) => providerName.trim())
    .filter(Boolean)
    .sort()
    .forEach((providerName) => {
      query.append('providerName', providerName);
    });

  return query.toString();
};

const clearPaymentRecordsCache = () => {
  paymentRecordsCache.clear();
  paymentRecordsRequests.clear();
  AsyncStorage.getAllKeys()
    .then((keys) =>
      AsyncStorage.multiRemove(
        keys.filter((key) => key.startsWith(PAYMENT_RECORDS_CACHE_PREFIX))
      )
    )
    .catch(() => {});
};

export async function createRequestHistory(data: CreateRequestHistoryData): Promise<RequestHistoryItem> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/requests`;
    logDebug('[API] Create request history:', url, data.requestId);

    const response = await apiFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      },
      AUTH_REQUEST_TIMEOUT_MS
    );

    const result = await parseJsonResponse<{
      request?: RequestHistoryItem;
      error?: string;
      message?: string;
    }>(response, 'Create request history');

    if (!response.ok) {
      throw new Error(result.error || result.message || 'Failed to save request');
    }

    clearRequestHistoryCache();
    if (!result.request) {
      throw new Error('Create request history returned no request data');
    }
    return result.request;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.warn('[API] Queueing request history for offline sync:', message);
    await enqueueOfflineAction({ type: 'createRequestHistory', data });
    clearRequestHistoryCache();
    return createOfflineRequestHistoryItem(data);
  }
}

export async function createPaymentRecord(data: CreatePaymentRecordData): Promise<PaymentRecordItem> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/payments`;
    logDebug('[API] Create payment record:', url, data.paymentId);

    const response = await apiFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      },
      AUTH_REQUEST_TIMEOUT_MS
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to save payment');
    }

    clearPaymentRecordsCache();
    return result.payment;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.warn('[API] Queueing payment record for offline sync:', message);
    await enqueueOfflineAction({ type: 'createPaymentRecord', data });
    clearPaymentRecordsCache();
    return createOfflinePaymentRecordItem(data);
  }
}

export async function initializePayment(data: InitializePaymentData): Promise<InitializePaymentResult> {
  const apiBaseUrl = await findHealthyApiBaseUrl();
  const url = `${apiBaseUrl}/api/payments/initialize`;
  logDebug('[API] Initialize payment:', url);

  const response = await apiFetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    },
    AUTH_REQUEST_TIMEOUT_MS
  );
  const result = await parseJsonResponse<InitializePaymentResult & { error?: string; message?: string }>(
    response,
    'Initialize payment'
  );

  if (!response.ok) {
    throw new Error(result.error || result.message || 'Unable to initialize payment');
  }

  if (!result.authorizationUrl || !result.reference) {
    throw new Error('Payment initialization returned incomplete checkout details.');
  }

  clearPaymentRecordsCache();
  return result;
}

export async function cancelPayment(paymentId: string, driverId: string): Promise<PaymentRecordItem> {
  const apiBaseUrl = await findHealthyApiBaseUrl();
  const response = await apiFetch(`${apiBaseUrl}/api/payments`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId, driverId }),
  });
  const result = await parseJsonResponse<{ payment?: PaymentRecordItem; error?: string }>(response, 'Cancel payment');
  if (!response.ok || !result.payment) {
    throw new Error(result.error || 'Unable to cancel payment');
  }
  clearPaymentRecordsCache();
  return result.payment;
}

export async function verifyPayment(reference: string): Promise<{ ok: boolean; payment: PaymentRecordItem }> {
  const apiBaseUrl = await findHealthyApiBaseUrl();
  const url = `${apiBaseUrl}/api/payments/verify/${encodeURIComponent(reference)}`;
  logDebug('[API] Verify payment:', url);

  const response = await apiFetch(url, { method: 'GET' }, AUTH_REQUEST_TIMEOUT_MS);
  const result = await parseJsonResponse<{ ok: boolean; payment: PaymentRecordItem; error?: string; message?: string }>(
    response,
    'Verify payment'
  );

  if (!response.ok) {
    throw new Error(result.error || result.message || 'Unable to verify payment');
  }

  clearPaymentRecordsCache();
  return result;
}

export async function logout(userId: string, sessionId: string): Promise<void> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/auth/logout`;
    logDebug('[API] Logout request to:', url);

    const response = await apiFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, sessionId }),
      },
      LOGOUT_REQUEST_TIMEOUT_MS
    );

    const result: ApiResponse<User> = await response.json();

    if (!response.ok) {
      if (response.status >= 500) {
        console.warn('[API] Remote logout failed, clearing local session only:', result.error || result.message);
        return;
      }

      throw new Error(result.error || result.message || 'Logout failed');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.warn('[API] Remote logout unavailable, clearing local session only:', message);
  }
}

export async function registerPushToken(data: RegisterPushTokenData): Promise<void> {
  const apiBaseUrl = await findHealthyApiBaseUrl();
  const url = `${apiBaseUrl}/api/push-tokens`;
  logDebug('[API] Register push token:', url);

  const response = await apiFetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    },
    LOGOUT_REQUEST_TIMEOUT_MS
  );

  const result = await parseJsonResponse<{ error?: string; message?: string }>(
    response,
    'Register push token'
  );

  if (!response.ok) {
    throw new Error(result.error || result.message || 'Unable to register push token');
  }
}

export async function unregisterPushToken({
  userId,
  token,
}: {
  userId: string;
  token: string;
}): Promise<void> {
  const apiBaseUrl = await findHealthyApiBaseUrl();
  const url = `${apiBaseUrl}/api/push-tokens`;
  logDebug('[API] Remove push token:', url);

  const response = await apiFetch(
    url,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, token }),
    },
    LOGOUT_REQUEST_TIMEOUT_MS
  );

  const result = await parseJsonResponse<{ error?: string; message?: string }>(
    response,
    'Remove push token'
  );

  if (!response.ok) {
    throw new Error(result.error || result.message || 'Unable to remove push token');
  }
}

export async function getRequestHistory(params: {
  driverId?: string | null;
  driverName?: string | null;
  mechanicId?: string | null;
  providerName?: string | null;
  providerNames?: string[];
  pendingOnly?: boolean;
  forceRefresh?: boolean;
}): Promise<RequestHistoryItem[]> {
  const queryString = buildRequestHistoryQuery(params);

  if (!queryString) {
    if (__DEV__) {
      console.warn(
        '[API] Skipping request history load: driverId, driverName, mechanicId, or providerName is required'
      );
    }
    return [];
  }

  const cacheKey = `${REQUEST_HISTORY_CACHE_PREFIX}${queryString}`;
  const now = Date.now();
  const memoryCache = requestHistoryCache.get(cacheKey);

  if (!params.forceRefresh && memoryCache && now - memoryCache.timestamp < REQUEST_HISTORY_CACHE_TTL_MS) {
    return memoryCache.requests;
  }

  if (!params.forceRefresh && requestHistoryRequests.has(cacheKey)) {
    return requestHistoryRequests.get(cacheKey)!;
  }

  const storedCacheJson = await AsyncStorage.getItem(cacheKey);
  const storedCache = storedCacheJson
    ? (JSON.parse(storedCacheJson) as { timestamp: number; requests: RequestHistoryItem[] })
    : null;

  if (!params.forceRefresh && storedCache && now - storedCache.timestamp < REQUEST_HISTORY_CACHE_TTL_MS) {
    requestHistoryCache.set(cacheKey, storedCache);
    return storedCache.requests;
  }

  const requestPromise = (async () => {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/requests?${queryString}`;
    logDebug('[API] Get request history:', url);

    const response = await apiFetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await parseJsonResponse<{
      requests?: RequestHistoryItem[];
      error?: string;
      message?: string;
    }>(response, 'Load request history');

    if (!response.ok) {
      throw new Error(result.error || result.message || 'Failed to load request history');
    }

    const requests = result.requests || [];
    const cacheValue = { timestamp: Date.now(), requests };
    requestHistoryCache.set(cacheKey, cacheValue);
    await AsyncStorage.setItem(cacheKey, JSON.stringify(cacheValue));
    syncOfflineChanges().catch(() => {});
    return requests;
  } catch (error) {
    if (storedCache) {
      warnCachedFallback(`request-history:${cacheKey}`, '[API] Using cached request history after load failure');
      requestHistoryCache.set(cacheKey, storedCache);
      return storedCache.requests;
    }

    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.error('[API] Get request history error:', message);
    throw new Error(`Load request history error: ${message}`);
  } finally {
    requestHistoryRequests.delete(cacheKey);
  }
  })();

  requestHistoryRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function getPaymentRecords(params: {
  driverId?: string | null;
  driverName?: string | null;
  mechanicId?: string | null;
  providerName?: string | null;
  providerNames?: string[];
  forceRefresh?: boolean;
}): Promise<PaymentRecordItem[]> {
  const queryString = buildPaymentRecordsQuery(params);

  if (!queryString) {
    if (__DEV__) {
      console.warn(
        '[API] Skipping payment records load: driverId, driverName, mechanicId, or providerName is required'
      );
    }
    return [];
  }

  const cacheKey = `${PAYMENT_RECORDS_CACHE_PREFIX}${queryString}`;
  const now = Date.now();
  const memoryCache = paymentRecordsCache.get(cacheKey);

  if (!params.forceRefresh && memoryCache && now - memoryCache.timestamp < PAYMENT_RECORDS_CACHE_TTL_MS) {
    return memoryCache.payments;
  }

  if (!params.forceRefresh && paymentRecordsRequests.has(cacheKey)) {
    return paymentRecordsRequests.get(cacheKey)!;
  }

  const storedCacheJson = await AsyncStorage.getItem(cacheKey);
  const storedCache = storedCacheJson
    ? (JSON.parse(storedCacheJson) as { timestamp: number; payments: PaymentRecordItem[] })
    : null;

  if (!params.forceRefresh && storedCache && now - storedCache.timestamp < PAYMENT_RECORDS_CACHE_TTL_MS) {
    paymentRecordsCache.set(cacheKey, storedCache);
    return storedCache.payments;
  }

  const requestPromise = (async () => {
    try {
      const apiBaseUrl = await findHealthyApiBaseUrl();
      const url = `${apiBaseUrl}/api/payments?${queryString}`;
      logDebug('[API] Get payment records:', url);

      const response = await apiFetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load payment records');
      }

      const payments = result.payments || [];
      const cacheValue = { timestamp: Date.now(), payments };
      paymentRecordsCache.set(cacheKey, cacheValue);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(cacheValue));
      syncOfflineChanges().catch(() => {});
      return payments;
    } catch (error) {
      if (storedCache) {
        warnCachedFallback(`payment-records:${cacheKey}`, '[API] Using cached payment records after load failure');
        paymentRecordsCache.set(cacheKey, storedCache);
        return storedCache.payments;
      }

      const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
      console.error('[API] Get payment records error:', message);
      throw new Error(`Load payment records error: ${message}`);
    } finally {
      paymentRecordsRequests.delete(cacheKey);
    }
  })();

  paymentRecordsRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function updateRequestHistoryStatus(data: {
  requestId: string;
  status: RequestHistoryItem['status'];
  acceptedBy?: string | null;
}): Promise<RequestHistoryItem> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/requests`;
    logDebug('[API] Update request history:', url, data.requestId, data.status);

    const response = await apiFetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await parseJsonResponse<{
      request?: RequestHistoryItem;
      error?: string;
      message?: string;
    }>(response, 'Update request history');

    if (!response.ok) {
      throw new Error(result.error || result.message || 'Failed to update request');
    }

    clearRequestHistoryCache();
    if (!result.request) {
      throw new Error('Update request history returned no request data');
    }
    return result.request;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.warn('[API] Queueing request status update for offline sync:', message);
    await enqueueOfflineAction({ type: 'updateRequestHistoryStatus', data });
    clearRequestHistoryCache();

    const now = new Date().toISOString();
    return {
      id: `offline-${data.requestId}`,
      requestId: data.requestId,
      type: 'service',
      status: data.status,
      driverName: '',
      providerName: '',
      currency: 'GHS',
      acceptedBy: data.acceptedBy,
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }
}

export async function createMechanicShop(
  data: CreateMechanicShopData,
  options: { databaseOnly?: boolean } = {}
): Promise<MechanicShopItem> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/mechanic-shops`;
    logDebug('[API] Create mechanic shop:', url, data.shopId);

    const response = await apiFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      },
      AUTH_REQUEST_TIMEOUT_MS
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to register mechanic shop');
    }

    const savedShop = result.shop;
    await setMechanicShopsLocalCache([
      ...(mechanicShopsCache || []).filter((shop) => shop.id !== savedShop.id && shop.shopId !== savedShop.shopId),
      savedShop,
    ]);
    mechanicShopsRequest = null;

    return savedShop;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    if (options.databaseOnly) {
      throw new Error(`Unable to save towing company to the database: ${message}`);
    }

    console.warn('[API] Queueing mechanic shop registration for offline sync:', message);
    await enqueueOfflineAction({ type: 'createMechanicShop', data });
    const offlineShop = createOfflineMechanicShopItem(data);
    await setMechanicShopsLocalCache([
      ...(mechanicShopsCache || []).filter((shop) => shop.id !== offlineShop.id && shop.shopId !== offlineShop.shopId),
      offlineShop,
    ]);
    mechanicShopsRequest = null;
    return offlineShop;
  }
}

export async function updateMechanicShopStatus(data: {
  shopId: string;
  status: 'active' | 'inactive';
  providerType?: string;
}): Promise<MechanicShopItem> {
  return updateMechanicShop(data, 'status');
}

export async function updateMechanicShop(data: {
  shopId: string;
  status?: 'active' | 'inactive';
  shopName?: string;
  providerType?: string;
}, action: 'status' | 'details' = 'details'): Promise<MechanicShopItem> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/mechanic-shops`;
    logDebug('[API] Update mechanic shop:', url, data.shopId, action);

    const response = await apiFetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to update mechanic shop');
    }

    const savedShop = result.shop;
    await setMechanicShopsLocalCache([
      ...(mechanicShopsCache || []).filter((shop) => shop.id !== savedShop.id && shop.shopId !== savedShop.shopId),
      savedShop,
    ]);
    await syncMechanicShopLocationCaches(savedShop);
    mechanicShopsRequest = null;

    return savedShop;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
    console.warn('[API] Queueing mechanic shop update for offline sync:', message);
    await enqueueOfflineAction({ type: 'updateMechanicShop', data });

    const cachedShopsJson = await AsyncStorage.getItem(MECHANIC_SHOPS_CACHE_KEY);
    const cachedShops = cachedShopsJson
      ? (JSON.parse(cachedShopsJson) as MechanicShopItem[])
      : mechanicShopsCache || [];
    const existingShop = cachedShops.find((shop) => shop.shopId === data.shopId);

    if (!existingShop) {
      throw new Error(`Update shop error: ${message}`);
    }

    const offlineShop: MechanicShopItem = {
      ...existingShop,
      ...(data.status ? { status: data.status } : {}),
      ...(data.shopName ? { shopName: data.shopName } : {}),
      updatedAt: new Date().toISOString(),
    };

    await setMechanicShopsLocalCache([
      ...cachedShops.filter((shop) => shop.shopId !== offlineShop.shopId),
      offlineShop,
    ]);
    await syncMechanicShopLocationCaches(offlineShop);
    mechanicShopsRequest = null;
    return offlineShop;
  }
}

const syncMechanicShopLocationCaches = async (savedShop: MechanicShopItem) => {
  const updateShopLocationCache = (json: string | null) => {
    if (!json) return null;

    const shops = JSON.parse(json) as Array<Record<string, any>>;
    let changed = false;
    const updatedShops = shops.map((shop) => {
      const matchesShop =
        shop.id === savedShop.shopId ||
        shop.shopId === savedShop.shopId ||
        (savedShop.licenseNumber && shop.licenseNumber === savedShop.licenseNumber);

      if (!matchesShop) return shop;

      changed = true;
      return {
        ...shop,
        id: shop.id || savedShop.shopId,
        name: savedShop.shopName,
        shopName: savedShop.shopName,
        phone: savedShop.phone,
        location: savedShop.location,
        city: savedShop.location,
        specialization: savedShop.specialization,
        licenseNumber: savedShop.licenseNumber,
        latitude: savedShop.latitude,
        longitude: savedShop.longitude,
        providerType: savedShop.providerType,
        status: savedShop.status,
        bankName: savedShop.bankName,
        bankCode: savedShop.bankCode,
        accountNumber: savedShop.accountNumber,
        accountName: savedShop.accountName,
        paystackSubaccountCode: savedShop.paystackSubaccountCode,
      };
    });

    return changed ? JSON.stringify(updatedShops) : null;
  };

  const [registeredShops, cachedNearbyShops] = await AsyncStorage.multiGet([
    'registeredShops',
    'cachedNearbyShops',
  ]);

  const updates: [string, string][] = [];
  const updatedRegisteredShops = updateShopLocationCache(registeredShops[1]);
  const updatedCachedNearbyShops = updateShopLocationCache(cachedNearbyShops[1]);

  if (updatedRegisteredShops) {
    updates.push(['registeredShops', updatedRegisteredShops]);
  }
  if (updatedCachedNearbyShops) {
    updates.push(['cachedNearbyShops', updatedCachedNearbyShops]);
    updates.push(['cachedShopsTimestamp', Date.now().toString()]);
  }

  if (updates.length > 0) {
    await AsyncStorage.multiSet(updates);
  }
};

export async function getMechanicShops(options: { forceRefresh?: boolean; providerType?: string; databaseOnly?: boolean; includeInactive?: boolean } = {}): Promise<MechanicShopItem[]> {
  const providerType = options.providerType?.trim();

  if (!providerType && mechanicShopsRequest) {
    return mechanicShopsRequest;
  }

  if (options.forceRefresh) {
    mechanicShopsRequest = null;
  }

  if (!options.forceRefresh && mechanicShopsCache) {
    mechanicShopsCache = withoutRemovedLocalMechanicShops(mechanicShopsCache);
    mechanicShopsCache = mechanicShopsCache.filter((shop) => isApprovedMechanicShop(shop, options.includeInactive));
    if (providerType) {
      return mechanicShopsCache.filter((shop) => shop.providerType === providerType);
    }
    return mechanicShopsCache;
  }

  const cachedShopsJson = await AsyncStorage.getItem(MECHANIC_SHOPS_CACHE_KEY);
  const cachedShops = cachedShopsJson
    ? withoutRemovedLocalMechanicShops(JSON.parse(cachedShopsJson) as MechanicShopItem[])
    : null;

  if (!options.forceRefresh && cachedShops) {
    const cached = await setMechanicShopsLocalCache(
      cachedShops.filter((shop) => isApprovedMechanicShop(shop, options.includeInactive))
    );
    if (providerType) {
      return cached.filter((shop) => shop.providerType === providerType);
    }
    return cached;
  }

  const requestPromise = (async () => {
    try {
      const apiBaseUrl = await findHealthyApiBaseUrl();
      const queryParams = new URLSearchParams();
      if (providerType) {
        queryParams.set('providerType', providerType);
      }
      if (options.includeInactive) {
        queryParams.set('includeInactive', 'true');
      }
      const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
      const url = `${apiBaseUrl}/api/mechanic-shops${query}`;
      logDebug('[API] Get mechanic shops:', url);

      const response = await apiFetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load mechanic shops');
      }

      const resultShops = withoutRemovedLocalMechanicShops((result.shops || []) as MechanicShopItem[])
        .filter((shop) => isApprovedMechanicShop(shop, options.includeInactive));
      if (providerType) {
        return resultShops;
      }

      const shops = await setMechanicShopsLocalCache(resultShops);
      syncOfflineChanges().catch(() => {});
      return shops;
    } catch (error) {
      mechanicShopsRequest = null;

      if (options.databaseOnly) {
        const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
        throw new Error(`Unable to load mechanic shops from the database: ${message}`);
      }

      if (cachedShops) {
        warnCachedFallback(`mechanic-shops:${providerType || 'all'}`, '[API] Using cached mechanic shops after load failure');
        if (providerType) {
          return cachedShops.filter((shop) => shop.providerType === providerType);
        }
        return setMechanicShopsLocalCache(cachedShops);
      }

      const message = error instanceof Error ? error.message : 'Network error - Backend may not be running or URL is incorrect';
      console.error('[API] Get mechanic shops error:', message);
      throw new Error(`Load mechanic shops error: ${message}`);
    }
  })();

  if (providerType) {
    return requestPromise;
  }

  mechanicShopsRequest = requestPromise;
  requestPromise.then(
    () => {
      if (mechanicShopsRequest === requestPromise) {
        mechanicShopsRequest = null;
      }
    },
    () => {
      if (mechanicShopsRequest === requestPromise) {
        mechanicShopsRequest = null;
      }
    }
  );
  return mechanicShopsRequest;
}

export function clearMechanicShopsCache() {
  mechanicShopsCache = null;
  mechanicShopsRequest = null;
  AsyncStorage.removeItem(MECHANIC_SHOPS_CACHE_KEY).catch(() => {});
}

/**
 * Request a local in-app password reset code for the given email.
 */
export async function sendPasswordReset(email: string): Promise<{
  ok: boolean;
  message?: string;
  resetCode?: string;
  expiresAt?: string;
}> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/auth/forgot-password/`;
    logDebug('[API] Password reset request to:', url, 'email:', email);

    const response = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[API] Password reset failed:', response.status, result);
      return { ok: false, message: result?.error || result?.message || 'Password reset failed' };
    }

    return {
      ok: true,
      message: result?.message,
      resetCode: typeof result?.resetCode === 'string' ? result.resetCode : undefined,
      expiresAt: typeof result?.expiresAt === 'string' ? result.expiresAt : undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[API] Password reset error:', msg);
    return { ok: false, message: `Network error: ${msg}` };
  }
}

/**
 * Confirm a password reset using the local in-app reset code.
 */
export async function resetPassword(payload: {
  email: string;
  token: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ ok: boolean; message?: string }> {
  try {
    const apiBaseUrl = await findHealthyApiBaseUrl();
    const url = `${apiBaseUrl}/api/auth/reset-password/`;
    logDebug('[API] Reset password request to:', url);

    const response = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[API] Reset password failed:', response.status, result);
      return { ok: false, message: result?.error || result?.message || 'Reset failed' };
    }

    return { ok: true, message: result?.message };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[API] Reset password error:', msg);
    return { ok: false, message: `Network error: ${msg}` };
  }
}

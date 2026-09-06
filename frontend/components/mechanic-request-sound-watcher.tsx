import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef } from 'react';
import {
  getMechanicShops,
  getRequestHistory,
  type RequestHistoryItem,
} from '../services/api-client';
import { playMechanicRequestSound, stopMechanicRequestSound } from '../services/notification-sound';

const USER_ID_KEY = 'userId';
const USER_ROLE_KEY = 'userRole';
const MECHANIC_NAME_KEY = 'mechanicName';
const SERVICE_REQUESTS_STORAGE_KEY = 'serviceRequests';
const TOW_REQUESTS_STORAGE_KEY = 'towRequests';
const POLL_INTERVAL_MS = 1500;

type LocalRequest = {
  id: string;
  mechanicId?: string;
  mechanicName?: string;
  serviceName?: string;
  status?: string;
};

type CachedShop = {
  mechanicId?: string | null;
  name?: string;
  shopName?: string;
  providerType?: string;
};

const isPendingStatus = (status?: string) => {
  const normalizedStatus = (status || '').toLowerCase();
  return normalizedStatus === 'pending' || normalizedStatus === 'confirmed';
};

const collectPendingIds = (requests: RequestHistoryItem[]) =>
  requests
    .filter((request) => isPendingStatus(request.status))
    .map((request) => request.requestId);

async function getMechanicPendingRequestIds() {
  const [userId, userRole, mechanicName] = await Promise.all([
    AsyncStorage.getItem(USER_ID_KEY),
    AsyncStorage.getItem(USER_ROLE_KEY),
    AsyncStorage.getItem(MECHANIC_NAME_KEY),
  ]);

  if (!userId || userRole !== 'mechanic') {
    return null;
  }

  const providerNames = new Set<string>();
  if (mechanicName?.trim()) {
    providerNames.add(mechanicName.trim());
  }

  const shops = await getMechanicShops({ forceRefresh: true }).catch(() => []);
  shops
    .filter((shop) => shop.providerType !== 'tow' && shop.mechanicId === userId)
    .forEach((shop) => providerNames.add(shop.shopName));

  const [registeredShopsJson, cachedNearbyShopsJson] = await Promise.all([
    AsyncStorage.getItem('registeredShops'),
    AsyncStorage.getItem('cachedNearbyShops'),
  ]);
  const cachedShops: CachedShop[] = [
    ...(registeredShopsJson ? JSON.parse(registeredShopsJson) : []),
    ...(cachedNearbyShopsJson ? JSON.parse(cachedNearbyShopsJson) : []),
  ];

  cachedShops
    .filter((shop) => shop.providerType !== 'tow' && (!shop.mechanicId || shop.mechanicId === userId))
    .forEach((shop) => {
      const shopName = shop.shopName || shop.name;
      if (shopName?.trim()) {
        providerNames.add(shopName.trim());
      }
    });

  const pendingIds = new Set<string>();
  await getRequestHistory({
    mechanicId: userId,
    providerNames: Array.from(providerNames),
    forceRefresh: true,
  })
    .then((requests) => {
      collectPendingIds(requests).forEach((requestId) => pendingIds.add(requestId));
    })
    .catch(() => {});

  const [serviceRequestsJson, towRequestsJson] = await Promise.all([
    AsyncStorage.getItem(SERVICE_REQUESTS_STORAGE_KEY),
    AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY),
  ]);
  const serviceRequests: LocalRequest[] = serviceRequestsJson ? JSON.parse(serviceRequestsJson) : [];
  const towRequests: LocalRequest[] = towRequestsJson ? JSON.parse(towRequestsJson) : [];

  serviceRequests
    .filter((request) => request.mechanicId === userId || providerNames.has(request.mechanicName || ''))
    .filter((request) => isPendingStatus(request.status))
    .forEach((request) => pendingIds.add(request.id));

  towRequests
    .filter((request) => providerNames.size === 0 || providerNames.has(request.serviceName || ''))
    .filter((request) => isPendingStatus(request.status))
    .forEach((request) => pendingIds.add(request.id));

  return pendingIds;
}

export function MechanicRequestSoundWatcher() {
  const seenPendingRequestIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    let isChecking = false;

    const checkForNewRequests = async () => {
      if (isChecking) {
        return;
      }

      isChecking = true;
      try {
        const pendingIds = await getMechanicPendingRequestIds();

        if (!isMounted) {
          return;
        }

        if (!pendingIds) {
          initializedRef.current = false;
          if (seenPendingRequestIdsRef.current.size > 0) {
            stopMechanicRequestSound();
          }
          seenPendingRequestIdsRef.current = new Set();
          return;
        }

        if (!initializedRef.current) {
          seenPendingRequestIdsRef.current = pendingIds;
          initializedRef.current = true;
          return;
        }

        const hadResolvedPendingRequest = Array.from(seenPendingRequestIdsRef.current).some(
          (requestId) => !pendingIds.has(requestId)
        );
        const hasNewPendingRequest = Array.from(pendingIds).some(
          (requestId) => !seenPendingRequestIdsRef.current.has(requestId)
        );

        if (hadResolvedPendingRequest) {
          stopMechanicRequestSound();
        }

        if (hasNewPendingRequest) {
          playMechanicRequestSound();
        }

        seenPendingRequestIdsRef.current = pendingIds;
      } catch (error) {
        console.error('Unable to check mechanic request sound notification:', error);
      } finally {
        isChecking = false;
      }
    };

    checkForNewRequests();
    const intervalId = setInterval(checkForNewRequests, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  return null;
}

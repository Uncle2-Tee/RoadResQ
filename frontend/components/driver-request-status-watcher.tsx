import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { getRequestHistory, type RequestHistoryItem } from '../services/api-client';
import { REQUEST_OVERVIEW_UPDATED_AT_KEY } from '../services/request-sync';

const USER_ID_KEY = 'userId';
const USER_ROLE_KEY = 'userRole';
const DRIVER_NAME_KEY = 'driverName';
const SERVICE_REQUESTS_STORAGE_KEY = 'serviceRequests';
const TOW_REQUESTS_STORAGE_KEY = 'towRequests';
const POLL_INTERVAL_MS = 1200;

type LocalRequest = {
  id: string;
  driverName?: string;
  status?: string;
};

type RequestSnapshot = {
  id: string;
  status: string;
};

const normalizeStatus = (status?: string) => (status || '').toLowerCase();
const isDecisionStatus = (status?: string) => {
  const normalizedStatus = normalizeStatus(status);
  return normalizedStatus === 'accepted' || normalizedStatus === 'declined';
};

async function getDriverRequestSnapshots() {
  const [userId, userRole, driverName] = await Promise.all([
    AsyncStorage.getItem(USER_ID_KEY),
    AsyncStorage.getItem(USER_ROLE_KEY),
    AsyncStorage.getItem(DRIVER_NAME_KEY),
  ]);

  if (!userId || userRole !== 'driver') {
    return null;
  }

  const requestMap = new Map<string, RequestSnapshot>();

  await getRequestHistory({
    driverId: userId,
    driverName: driverName || 'Driver',
    forceRefresh: true,
  })
    .then((requests: RequestHistoryItem[]) => {
      requests.forEach((request) => {
        requestMap.set(request.requestId, {
          id: request.requestId,
          status: normalizeStatus(request.status),
        });
      });
    })
    .catch(() => {});

  const [serviceRequestsJson, towRequestsJson] = await Promise.all([
    AsyncStorage.getItem(SERVICE_REQUESTS_STORAGE_KEY),
    AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY),
  ]);
  const serviceRequests: LocalRequest[] = serviceRequestsJson ? JSON.parse(serviceRequestsJson) : [];
  const towRequests: LocalRequest[] = towRequestsJson ? JSON.parse(towRequestsJson) : [];

  [...serviceRequests, ...towRequests]
    .filter((request) => !driverName || request.driverName === driverName)
    .forEach((request) => {
      const localStatus = normalizeStatus(request.status);
      const existingStatus = requestMap.get(request.id)?.status;

      if (!existingStatus || isDecisionStatus(localStatus)) {
        requestMap.set(request.id, {
          id: request.id,
          status: localStatus,
        });
      }
    });

  return requestMap;
}

export function DriverRequestStatusWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const previousStatusesRef = useRef<Map<string, string>>(new Map());
  const initializedRef = useRef(false);
  const redirectingRef = useRef(false);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let isMounted = true;
    let isChecking = false;

    const checkForDriverStatusUpdate = async () => {
      if (isChecking || redirectingRef.current) {
        return;
      }

      isChecking = true;
      try {
        const snapshots = await getDriverRequestSnapshots();

        if (!isMounted) {
          return;
        }

        if (!snapshots) {
          initializedRef.current = false;
          previousStatusesRef.current = new Map();
          redirectingRef.current = false;
          return;
        }

        const changedDecision = Array.from(snapshots.values()).find((snapshot) => {
          const previousStatus = previousStatusesRef.current.get(snapshot.id);
          return (
            initializedRef.current &&
            previousStatus &&
            previousStatus !== snapshot.status &&
            isDecisionStatus(snapshot.status)
          );
        });

        previousStatusesRef.current = new Map(
          Array.from(snapshots.values()).map((snapshot) => [snapshot.id, snapshot.status])
        );
        initializedRef.current = true;

        if (changedDecision && pathnameRef.current !== '/request') {
          redirectingRef.current = true;
          await AsyncStorage.setItem(REQUEST_OVERVIEW_UPDATED_AT_KEY, Date.now().toString());
          router.replace('/request');
          setTimeout(() => {
            redirectingRef.current = false;
          }, 2500);
        }
      } catch (error) {
        console.error('Unable to check driver request status update:', error);
      } finally {
        isChecking = false;
      }
    };

    checkForDriverStatusUpdate();
    const intervalId = setInterval(checkForDriverStatusUpdate, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [router]);

  return null;
}

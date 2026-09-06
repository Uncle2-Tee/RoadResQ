import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import {
  getMechanicShops,
  getRequestHistory,
  type RequestHistoryItem,
} from '../services/api-client';
import { playMechanicRequestSound, stopMechanicRequestSound } from '../services/notification-sound';
import { AppIcon } from './app-icon';
import { TouchableOpacity } from './haptic-touchable-opacity';
import { ThemedText } from './themed-text';

const USER_ID_KEY = 'userId';
const USER_ROLE_KEY = 'userRole';
const LAST_AUTHENTICATED_ROLE_KEY = 'lastAuthenticatedRole';
const LAST_MECHANIC_ID_KEY = 'lastAuthenticatedMechanicId';
const LAST_MECHANIC_NAME_KEY = 'lastAuthenticatedMechanicName';
const SERVICE_REQUESTS_STORAGE_KEY = 'serviceRequests';
const TOW_REQUESTS_STORAGE_KEY = 'towRequests';
const POLL_INTERVAL_MS = 5000;

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

const isPendingRequest = (status?: string) => {
  const normalizedStatus = (status || '').toLowerCase();
  return normalizedStatus === 'pending' || normalizedStatus === 'confirmed';
};

const normalizeName = (value?: string | null) => value?.trim().toLowerCase() || '';

const addName = (names: Set<string>, value?: string | null) => {
  const normalized = normalizeName(value);
  if (normalized) {
    names.add(normalized);
  }
};

async function getTargetMechanicNames(mechanicId: string | null, mechanicName: string | null) {
  const providerNames = new Set<string>();
  addName(providerNames, mechanicName);

  const shops = await getMechanicShops({ forceRefresh: true }).catch(() => []);
  shops
    .filter((shop) => shop.providerType !== 'tow' && Boolean(mechanicId) && shop.mechanicId === mechanicId)
    .forEach((shop) => addName(providerNames, shop.shopName));

  const [registeredShopsJson, cachedNearbyShopsJson] = await Promise.all([
    AsyncStorage.getItem('registeredShops'),
    AsyncStorage.getItem('cachedNearbyShops'),
  ]);
  const cachedShops: CachedShop[] = [
    ...(registeredShopsJson ? JSON.parse(registeredShopsJson) : []),
    ...(cachedNearbyShopsJson ? JSON.parse(cachedNearbyShopsJson) : []),
  ];

  cachedShops
    .filter((shop) => shop.providerType !== 'tow' && Boolean(mechanicId) && shop.mechanicId === mechanicId)
    .forEach((shop) => addName(providerNames, shop.shopName || shop.name));

  return providerNames;
}

const requestBelongsToMechanic = (
  request: LocalRequest | RequestHistoryItem,
  mechanicId: string | null,
  providerNames: Set<string>
) => {
  if (!mechanicId && providerNames.size === 0) {
    return true;
  }

  if (mechanicId && 'mechanicId' in request && request.mechanicId === mechanicId) {
    return true;
  }

  if ('providerName' in request && providerNames.has(normalizeName(request.providerName))) {
    return true;
  }

  if ('mechanicName' in request && providerNames.has(normalizeName(request.mechanicName))) {
    return true;
  }

  return 'serviceName' in request && providerNames.has(normalizeName(request.serviceName));
};

async function getPendingRequestIds(mechanicId: string | null, mechanicName: string | null) {
  const pendingRequestIds = new Set<string>();
  const providerNames = await getTargetMechanicNames(mechanicId, mechanicName);
  const hasMechanicIdentity = Boolean(mechanicId || mechanicName?.trim() || providerNames.size > 0);

  await getRequestHistory({
    mechanicId: mechanicId || undefined,
    providerNames: hasMechanicIdentity ? Array.from(providerNames) : undefined,
    pendingOnly: !hasMechanicIdentity,
    forceRefresh: true,
  })
    .then((requests) => {
      requests
        .filter((request) => isPendingRequest(request.status))
        .filter((request) => requestBelongsToMechanic(request, mechanicId, providerNames))
        .forEach((request) => pendingRequestIds.add(request.requestId));
    })
    .catch(() => {});

  const [serviceRequestsJson, towRequestsJson] = await Promise.all([
    AsyncStorage.getItem(SERVICE_REQUESTS_STORAGE_KEY),
    AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY),
  ]);

  const serviceRequests: LocalRequest[] = serviceRequestsJson ? JSON.parse(serviceRequestsJson) : [];
  const towRequests: LocalRequest[] = towRequestsJson ? JSON.parse(towRequestsJson) : [];

  serviceRequests
    .filter((request) => isPendingRequest(request.status))
    .filter((request) => requestBelongsToMechanic(request, mechanicId, providerNames))
    .forEach((request) => pendingRequestIds.add(request.id));

  towRequests
    .filter((request) => isPendingRequest(request.status))
    .filter((request) => requestBelongsToMechanic(request, mechanicId, providerNames))
    .forEach((request) => pendingRequestIds.add(request.id));

  return pendingRequestIds;
}

export function BlinkingRequestNotification() {
  const router = useRouter();
  const pathname = usePathname();
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const seenPendingRequestIdsRef = useRef<Set<string>>(new Set());
  const [pendingCount, setPendingCount] = useState(0);
  const [showNotification, setShowNotification] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const refreshNotification = async () => {
      try {
        const [userId, userRole, lastAuthenticatedRole, lastMechanicId, lastMechanicName] =
          await Promise.all([
          AsyncStorage.getItem(USER_ID_KEY),
          AsyncStorage.getItem(USER_ROLE_KEY),
          AsyncStorage.getItem(LAST_AUTHENTICATED_ROLE_KEY),
          AsyncStorage.getItem(LAST_MECHANIC_ID_KEY),
          AsyncStorage.getItem(LAST_MECHANIC_NAME_KEY),
        ]);
        const isLoggedIn = Boolean(userId && userRole);
        const hasMechanicIdentity = Boolean(lastMechanicId || lastMechanicName?.trim());
        const shouldCheckRequests =
          !isLoggedIn &&
          pathname === '/login' &&
          (hasMechanicIdentity || lastAuthenticatedRole !== 'driver');
        const pendingIds = shouldCheckRequests
          ? await getPendingRequestIds(lastMechanicId, lastMechanicName)
          : new Set<string>();

        if (isMounted) {
          const hadResolvedPendingRequest = Array.from(seenPendingRequestIdsRef.current).some(
            (requestId) => !pendingIds.has(requestId)
          );
          const hasNewRequest = Array.from(pendingIds).some(
            (requestId) => !seenPendingRequestIdsRef.current.has(requestId)
          );

          if (hadResolvedPendingRequest) {
            stopMechanicRequestSound();
          }

          if (shouldCheckRequests && hasNewRequest) {
            playMechanicRequestSound();
          }

          seenPendingRequestIdsRef.current = pendingIds;
          setPendingCount(pendingIds.size);
          setShowNotification(shouldCheckRequests && pendingIds.size > 0);
        }
      } catch (error) {
        console.error('Unable to load pending request notification:', error);
      }
    };

    refreshNotification();
    const intervalId = setInterval(refreshNotification, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [pathname]);

  useEffect(() => {
    if (!showNotification) {
      opacity.setValue(1);
      scale.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0.6,
            duration: 520,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.08,
            duration: 520,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 520,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 520,
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [opacity, scale, showNotification]);

  if (!showNotification) {
    return null;
  }

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ scale }] }]}>
      <TouchableOpacity
        style={styles.button}
        activeOpacity={0.9}
        onPress={() => router.replace('/login')}
        accessibilityRole="button"
        accessibilityLabel={`${pendingCount} pending mechanic request${pendingCount === 1 ? '' : 's'}. Login as mechanic.`}
      >
        <AppIcon name="bell" size={24} color="#fff" />
        <View style={styles.badge}>
          <ThemedText style={styles.badgeText}>{pendingCount > 9 ? '9+' : pendingCount}</ThemedText>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 54,
    right: 22,
    zIndex: 1000,
    elevation: 1000,
  },
  button: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#D32F2F',
    borderWidth: 2,
    borderColor: '#FFB84D',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.24,
    shadowRadius: 9,
    elevation: 8,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#111827',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
});

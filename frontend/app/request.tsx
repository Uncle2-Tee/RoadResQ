import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Clipboard, Image, ScrollView, StyleSheet, View } from 'react-native';
import { AppIcon } from '../components/app-icon';
import { BlinkingCard } from '../components/blinking-card';
import { BottomNav } from '../components/bottom-nav';
import { Drawer } from '../components/drawer';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { LocationNameText } from '../components/location-name-text';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { useResponsive } from '../hooks/use-responsive';
import { getMechanicShops, getRequestHistory, RequestHistoryItem, updateRequestHistoryStatus } from '../services/api-client';
import {
  addHiddenRequestId,
  DRIVER_HIDDEN_REQUEST_IDS_KEY,
  getHiddenRequestIds,
  isRequestVisible,
  REQUEST_OVERVIEW_UPDATED_AT_KEY,
  touchRequestOverview,
  subscribeToRequestOverviewChanges,
} from '../services/request-sync';

const towImage = require('../assets/images/tow.jpg');

interface ServiceRequest {
  id: string;
  mechanicId: string;
  mechanicName: string;
  mechanicPhone: string;
  driverName: string;
  problemDescription: string;
  driverLocation?: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  updatedAt: string;
}

interface TowRequest {
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
  acceptedBy?: string;
}

interface ContactRecord {
  id: string;
  type: 'call' | 'sms' | 'chat';
  serviceName: string;
  servicePhone: string;
  mechanicId?: string;
  driverName: string;
  driverPhone?: string;
  location: string;
  problemDescription?: string;
  timestamp: string;
  status: 'called' | 'messaged' | 'chat';
}

type AllRequests = ServiceRequest | TowRequest | ContactRecord;

const DRIVER_NAME_KEY = 'driverName';
const MECHANIC_NAME_KEY = 'mechanicName';
const TOWER_NAME_KEY = 'towerName';
const USER_ID_KEY = 'userId';
const SERVICE_REQUESTS_STORAGE_KEY = 'serviceRequests';
const TOW_REQUESTS_STORAGE_KEY = 'towRequests';
const CONTACT_REQUESTS_STORAGE_KEY = 'contactRequests';
const COMPLETED_REQUEST_STATUSES = new Set(['accepted', 'declined']);
const ACTIVE_TOW_REQUEST_STATUSES = new Set(['pending', 'confirmed']);
const TOW_CONTACT_DUPLICATE_WINDOW_MS = 60 * 60 * 1000;
const TOW_SERVICE_DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
const GENERIC_ISSUE_DESCRIPTIONS = new Set([
  'tow service request',
  'mechanic service request',
  'no issue description provided',
]);
const removeRequestFromLocalHistory = async (requestIds: Set<string>, towIdentity?: string) => {
  const storageKeys = [
    SERVICE_REQUESTS_STORAGE_KEY,
    TOW_REQUESTS_STORAGE_KEY,
    CONTACT_REQUESTS_STORAGE_KEY,
  ];
  const storedEntries = await AsyncStorage.multiGet(storageKeys);
  const updates: [string, string][] = [];

  storedEntries.forEach(([storageKey, value]) => {
    if (!value) {
      return;
    }

    const records = JSON.parse(value) as Array<{ id?: string; type?: string; driverName?: string; serviceName?: string }>;
    const remainingRecords = records.filter((record) => {
      if (record.id && requestIds.has(record.id)) {
        return false;
      }

      if (towIdentity && record.type === 'tow') {
        return getTowRequestIdentity({
          driverName: record.driverName || '',
          serviceName: record.serviceName || '',
        }) !== towIdentity;
      }

      return true;
    });
    if (remainingRecords.length !== records.length) {
      updates.push([storageKey, JSON.stringify(remainingRecords)]);
    }
  });

  if (updates.length > 0) {
    await AsyncStorage.multiSet(updates);
  }
};

const normalizeRequestIdentityPart = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getTowRequestIdentity = (request: Pick<TowRequest, 'driverName' | 'serviceName'>) =>
  [
    normalizeRequestIdentityPart(request.driverName),
    normalizeRequestIdentityPart(request.serviceName),
  ].join(':');

const isTowRequest = (request: AllRequests): request is TowRequest =>
  (request as TowRequest).type === 'tow';

const isContactRecord = (request: AllRequests): request is ContactRecord =>
  ['call', 'sms', 'chat'].includes((request as ContactRecord).type);

const isServiceRequest = (request: AllRequests): request is ServiceRequest =>
  !isTowRequest(request) && !isContactRecord(request) && 'mechanicName' in request;

const isCallOnlyHistoryRequest = (request: AllRequests) =>
  (isContactRecord(request) && request.type === 'call') ||
  (isTowRequest(request) && request.problemDescription?.trim().toLowerCase() === 'called');

const getRequestTime = (request: AllRequests) =>
  new Date(
    (request as ServiceRequest).createdAt || (request as TowRequest).timestamp || (request as ContactRecord).timestamp
  ).getTime();

const isSameTowContactIdentity = (contact: ContactRecord, towRequest: TowRequest) => {
  const sameDriver =
    normalizeRequestIdentityPart(contact.driverName) === normalizeRequestIdentityPart(towRequest.driverName);
  const sameProvider =
    normalizeRequestIdentityPart(contact.serviceName) === normalizeRequestIdentityPart(towRequest.serviceName);
  const contactLocation = normalizeRequestIdentityPart(contact.location);
  const towLocation = normalizeRequestIdentityPart(towRequest.location);
  const sameLocation = !contactLocation || !towLocation || contactLocation === towLocation;
  const contactTime = getRequestTime(contact);
  const towTime = getRequestTime(towRequest);
  const closeInTime =
    Number.isFinite(contactTime) &&
    Number.isFinite(towTime) &&
    Math.abs(contactTime - towTime) <= TOW_CONTACT_DUPLICATE_WINDOW_MS;

  return sameDriver && sameProvider && sameLocation && closeInTime;
};

const removeTowContactDuplicates = (requests: AllRequests[]) => {
  const towRequests = requests.filter(isTowRequest);

  if (towRequests.length === 0) {
    return requests;
  }

  return requests.filter((request) => {
    if (!isContactRecord(request)) {
      return true;
    }

    return !towRequests.some((towRequest) => isSameTowContactIdentity(request, towRequest));
  });
};

const isSameTowServiceIdentity = (serviceRequest: ServiceRequest, towRequest: TowRequest) => {
  const sameDriver =
    normalizeRequestIdentityPart(serviceRequest.driverName) ===
    normalizeRequestIdentityPart(towRequest.driverName);
  const sameProvider =
    normalizeRequestIdentityPart(serviceRequest.mechanicName) ===
    normalizeRequestIdentityPart(towRequest.serviceName);
  const serviceLocation = normalizeRequestIdentityPart(serviceRequest.driverLocation);
  const towLocation = normalizeRequestIdentityPart(towRequest.location);
  const sameLocation =
    Boolean(serviceLocation) && Boolean(towLocation) && serviceLocation === towLocation;
  const serviceTime = getRequestTime(serviceRequest);
  const towTime = getRequestTime(towRequest);
  const closeInTime =
    Number.isFinite(serviceTime) &&
    Number.isFinite(towTime) &&
    Math.abs(serviceTime - towTime) <= TOW_SERVICE_DUPLICATE_WINDOW_MS;

  return sameDriver && sameProvider && sameLocation && closeInTime;
};

const removeTowServiceDuplicates = (requests: AllRequests[]) => {
  const towRequests = requests.filter(isTowRequest);
  if (towRequests.length === 0) {
    return requests;
  }

  const duplicateServiceIds = new Set<string>();
  const issueDescriptionByTowId = new Map<string, string>();

  towRequests.forEach((towRequest) => {
    const duplicateService = requests.find(
      (request): request is ServiceRequest =>
        isServiceRequest(request) && isSameTowServiceIdentity(request, towRequest)
    );

    if (!duplicateService) {
      return;
    }

    duplicateServiceIds.add(duplicateService.id);
    const description = duplicateService.problemDescription?.trim();
    if (description && !GENERIC_ISSUE_DESCRIPTIONS.has(description.toLocaleLowerCase())) {
      issueDescriptionByTowId.set(towRequest.id, description);
    }
  });

  return requests
    .filter((request) => !duplicateServiceIds.has(request.id))
    .map((request) => {
      if (!isTowRequest(request)) {
        return request;
      }

      const issueDescription = issueDescriptionByTowId.get(request.id);
      return issueDescription ? { ...request, problemDescription: issueDescription } : request;
    });
};

const normalizeRequestCards = (requests: AllRequests[]) =>
  dedupeTowRequests(
    removeTowServiceDuplicates(
      removeTowContactDuplicates(requests.filter((request) => !isCallOnlyHistoryRequest(request)))
    )
  );

const dedupeTowRequests = (requests: AllRequests[]) => {
  const activeTowRequests = new Map<string, TowRequest>();
  const result: AllRequests[] = [];

  for (const request of requests) {
    if (!isTowRequest(request)) {
      result.push(request);
      continue;
    }

    const isActive = ACTIVE_TOW_REQUEST_STATUSES.has((request.status || '').toLowerCase());
    if (!isActive) {
      result.push(request);
      continue;
    }

    const identity = getTowRequestIdentity(request);
    const existing = activeTowRequests.get(identity);
    const existingTime = existing ? new Date(existing.timestamp).getTime() : 0;
    const nextTime = new Date(request.timestamp).getTime();

    if (!existing || nextTime > existingTime) {
      activeTowRequests.set(identity, request);
    }
  }

  return [...result, ...activeTowRequests.values()];
};

const mapDatabaseRequest = (request: RequestHistoryItem): AllRequests => {
  if (request.type === 'tow') {
    return {
      id: request.requestId,
      type: 'tow',
      mechanicId: request.mechanicId || undefined,
      serviceName: request.providerName,
      servicePhone: request.providerPhone || '',
      driverName: request.driverName,
      location: request.driverLocation || 'Location not provided',
      problemDescription: request.problemDescription || 'No issue description provided',
      price: request.price || 0,
      currency: request.currency,
      estimatedTime: request.estimatedTime || 0,
      timestamp: request.requestedAt,
      status: request.status,
      acceptedBy: request.acceptedBy || undefined,
    };
  }

  if (['call', 'sms', 'chat'].includes(request.type)) {
    return {
      id: request.requestId,
      type: request.type as ContactRecord['type'],
      serviceName: request.providerName,
      servicePhone: request.providerPhone || '',
      mechanicId: request.mechanicId || undefined,
      driverName: request.driverName,
      driverPhone: request.driverPhone || undefined,
      location: request.driverLocation || 'Location not provided',
      problemDescription: request.problemDescription || undefined,
      timestamp: request.requestedAt,
      status: request.status as ContactRecord['status'],
    };
  }

  return {
    id: request.requestId,
    mechanicId: request.mechanicId || '',
    mechanicName: request.providerName,
    mechanicPhone: request.providerPhone || '',
    driverName: request.driverName,
    problemDescription: request.problemDescription || 'No issue description provided',
    driverLocation: request.driverLocation || undefined,
    status: request.status as ServiceRequest['status'],
    createdAt: request.requestedAt,
    updatedAt: request.updatedAt,
  };
};

export default function RequestScreen() {
  const router = useRouter();
  const responsive = useResponsive();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [driverName, setDriverName] = useState('Driver');
  const [userRole, setUserRole] = useState<'driver' | 'mechanic' | 'tower'>('driver');
  const [allRequests, setAllRequests] = useState<AllRequests[]>([]);
  const [filteredRequests, setFilteredRequests] = useState<AllRequests[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);
  const loadingRequestsRef = useRef(false);
  const lastOverviewUpdateRef = useRef<string | null>(null);

  const loadRequests = useCallback(async (options: { silent?: boolean } = {}) => {
    if (loadingRequestsRef.current) {
      return;
    }

    loadingRequestsRef.current = true;
    try {
      if (!options.silent) {
        setLoading(true);
      }
      
      // Get driver name
      const [savedDriverName, savedDriverId, savedRole, savedMechanicName, savedTowerName] = await Promise.all([
        AsyncStorage.getItem(DRIVER_NAME_KEY),
        AsyncStorage.getItem(USER_ID_KEY),
        AsyncStorage.getItem('userRole'),
        AsyncStorage.getItem(MECHANIC_NAME_KEY),
        AsyncStorage.getItem(TOWER_NAME_KEY),
      ]);
      const role = savedRole === 'mechanic' || savedRole === 'tower' ? savedRole : 'driver';
      setUserRole(role);

      const displayName =
        role === 'mechanic'
          ? savedMechanicName || savedDriverName || 'Mechanic'
          : role === 'tower'
            ? savedTowerName || savedDriverName || 'Tow Provider'
            : savedDriverName || 'Driver';

      if (displayName) {
        setDriverName(displayName);
      }
      const effectiveDriverName = savedDriverName || 'Driver';
      const providerNames = new Set<string>();
      const providerNameKeys = new Set<string>();

      const addProviderName = (value?: string | null) => {
        const name = value?.trim();
        if (!name) {
          return;
        }

        providerNames.add(name);
        providerNameKeys.add(normalizeRequestIdentityPart(name));
      };

      if (role === 'mechanic' && savedMechanicName?.trim()) {
        addProviderName(savedMechanicName);
      }

      if (role === 'tower' && savedTowerName?.trim()) {
        addProviderName(savedTowerName);
      }

      if (role === 'mechanic' || role === 'tower') {
        const shops = await getMechanicShops({
          forceRefresh: role === 'tower' ? !options.silent : options.silent,
          providerType: role === 'tower' ? 'tow' : undefined,
        }).catch(() => []);
        shops
          .filter((shop) => {
            if (role === 'mechanic' && shop.providerType?.toLowerCase() === 'tow') {
              return false;
            }

            if (role === 'tower' && shop.providerType?.toLowerCase() !== 'tow') {
              return false;
            }

            if (savedDriverId) {
              return shop.mechanicId === savedDriverId;
            }

            return providerNameKeys.has(normalizeRequestIdentityPart(shop.shopName));
          })
          .forEach((shop) => addProviderName(shop.shopName));
      }

      const hiddenRequestIdSet = await getHiddenRequestIds();

      const sortRequests = (requests: AllRequests[]) =>
        requests.sort((a, b) => {
          const timeA = new Date(
            (a as ServiceRequest).createdAt || (a as TowRequest).timestamp || (a as ContactRecord).timestamp
          ).getTime();
          const timeB = new Date(
            (b as ServiceRequest).createdAt || (b as TowRequest).timestamp || (b as ContactRecord).timestamp
          ).getTime();
          return timeB - timeA;
        });

      const [localRequestsJson, localTowRequestsJson, localContactRequestsJson] = await Promise.all([
        AsyncStorage.getItem(SERVICE_REQUESTS_STORAGE_KEY),
        AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY),
        AsyncStorage.getItem(CONTACT_REQUESTS_STORAGE_KEY),
      ]);

      const localRequests: ServiceRequest[] = localRequestsJson
        ? (JSON.parse(localRequestsJson) as ServiceRequest[])
        : [];
      const localTowRequests: TowRequest[] = localTowRequestsJson
        ? (JSON.parse(localTowRequestsJson) as TowRequest[])
        : [];
      const localContactRequests: ContactRecord[] = localContactRequestsJson
        ? (JSON.parse(localContactRequestsJson) as ContactRecord[])
        : [];
      const hiddenTowIdentities = new Set(
        localTowRequests
          .filter((request) => hiddenRequestIdSet.has(request.id))
          .map((request) => getTowRequestIdentity(request))
      );
      const isHiddenRequest = (request: AllRequests) =>
        hiddenRequestIdSet.has(request.id) ||
        (isTowRequest(request) && hiddenTowIdentities.has(getTowRequestIdentity(request)));
      const localDriverRequests: AllRequests[] =
        role === 'driver'
          ? [
              ...localRequests.filter((request) => request.driverName === effectiveDriverName),
              ...localTowRequests.filter((request) => request.driverName === effectiveDriverName),
              ...localContactRequests.filter((request) => request.driverName === effectiveDriverName),
            ]
          : [
              ...localRequests.filter((request) => providerNameKeys.has(normalizeRequestIdentityPart(request.mechanicName))),
              ...localTowRequests.filter(
                (request) => providerNameKeys.has(normalizeRequestIdentityPart(request.serviceName)) || request.mechanicId === savedDriverId
              ),
              ...localContactRequests.filter((request) => providerNameKeys.has(normalizeRequestIdentityPart(request.serviceName))),
            ];

      if (!options.silent && role !== 'tower') {
        const visibleLocalRequests = sortRequests(
          normalizeRequestCards(
            localDriverRequests
              .filter((request) => isRequestVisible(request.id, request.status, hiddenRequestIdSet))
              .filter((request) => !isHiddenRequest(request))
          )
        );
        setAllRequests(visibleLocalRequests);
        setLoading(false);
      }

      let loadedFromDatabase = false;
      const databaseRequests = await getRequestHistory(
        role === 'driver'
          ? {
              driverId: savedDriverId,
              driverName: effectiveDriverName,
              forceRefresh: options.silent,
            }
          : {
              mechanicId: savedDriverId,
              providerNames: Array.from(providerNames),
              forceRefresh: role === 'tower' || options.silent,
            }
      )
        .then((requests) => {
          loadedFromDatabase = true;
          return requests;
        })
        .catch(() => [] as RequestHistoryItem[]);

      const requestMap = new Map<string, AllRequests>();
      databaseRequests.map(mapDatabaseRequest).forEach((request) => {
        requestMap.set(request.id, request);
      });

      if (loadedFromDatabase) {
        const databaseRequestIds = new Set(databaseRequests.map((request) => request.requestId));
        const prunedLocalRequests = localRequests.filter(
          (request) =>
            role !== 'driver' ||
            request.driverName !== effectiveDriverName ||
            databaseRequestIds.has(request.id)
        );

        if (prunedLocalRequests.length !== localRequests.length) {
          await AsyncStorage.setItem(SERVICE_REQUESTS_STORAGE_KEY, JSON.stringify(prunedLocalRequests));
        }

        localDriverRequests
          .filter((request) => !databaseRequestIds.has(request.id))
          .filter((request) => role !== 'tower' && (isTowRequest(request) || isContactRecord(request)))
          .forEach((request) => {
            requestMap.set(request.id, request);
          });

        localDriverRequests
          .filter((request) => databaseRequestIds.has(request.id))
          .filter((request) => COMPLETED_REQUEST_STATUSES.has((request.status || '').toLowerCase()))
          .forEach((request) => {
            requestMap.set(request.id, request);
          });
      } else {
        localDriverRequests.forEach((request) => {
          requestMap.set(request.id, request);
        });
      }

      const combined = Array.from(requestMap.values()).filter((request) =>
        isRequestVisible(request.id, request.status, hiddenRequestIdSet)
      ).filter((request) => !isHiddenRequest(request));

      const roleScopedRequests =
        role === 'tower'
          ? normalizeRequestCards(combined.filter(isTowRequest))
          : normalizeRequestCards(combined);
      const sorted = sortRequests(roleScopedRequests);

      setAllRequests(sorted);
    } catch (error) {
      console.error('Error loading requests:', error);
    } finally {
      loadingRequestsRef.current = false;
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRequests();
      const refreshTimer = setInterval(() => {
        loadRequests({ silent: true });
      }, 2000);

      return () => {
        clearInterval(refreshTimer);
      };
    }, [loadRequests])
  );

  useEffect(() => {
    const unsubscribe = subscribeToRequestOverviewChanges(() => {
      loadRequests({ silent: true });
    });
    return () => {
      unsubscribe();
    };
  }, [loadRequests]);

  useEffect(() => {
    const intervalId = setInterval(async () => {
      const updatedAt = await AsyncStorage.getItem(REQUEST_OVERVIEW_UPDATED_AT_KEY);
      if (updatedAt && updatedAt !== lastOverviewUpdateRef.current) {
        lastOverviewUpdateRef.current = updatedAt;
        loadRequests({ silent: true });
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [loadRequests]);

  // Keep the rendered list in sync with the loaded requests
  useEffect(() => {
    setFilteredRequests([...allRequests]);
  }, [allRequests]);

  const handleCopyPhone = (phoneNumber: string) => {
    Clipboard.setString(phoneNumber);
    Alert.alert('Success', `Phone number copied: ${phoneNumber}`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted':
        return styles.statusAccepted;
      case 'called':
        return styles.statusCalled;
      case 'messaged':
        return styles.statusMessaged;
      case 'chat':
        return styles.statusChat;
      case 'declined':
        return styles.statusDeclined;
      default:
        return styles.statusPending;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'accepted':
        return 'Accepted';
      case 'called':
        return 'Called';
      case 'messaged':
        return 'SMS';
      case 'chat':
        return 'Chat';
      case 'declined':
        return 'Declined';
      case 'confirmed':
        return 'Pending';
      default:
        return 'Pending';
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateString;
    }
  };

  const isPendingStatus = (status?: string) => {
    const normalizedStatus = (status || '').toLowerCase();
    return normalizedStatus === 'pending' || normalizedStatus === 'confirmed';
  };

  const getRequestIssue = (request: AllRequests) => {
    if (['call', 'sms', 'chat'].includes((request as ContactRecord).type)) {
      const contact = request as ContactRecord;
      if (contact.problemDescription) return contact.problemDescription;
      if (contact.type === 'call') return 'Called';
      if (contact.type === 'sms') return 'No SMS message provided';
      return 'Chat with mechanic';
    }

    if ('mechanicName' in request) {
      return request.problemDescription;
    }

    if ((request as TowRequest).type === 'tow') {
      return (request as TowRequest).problemDescription || 'No issue description provided';
    }

    return 'No issue description provided';
  };

  const getRequestLocation = (request: AllRequests) => {
    if ('mechanicName' in request) {
      return request.driverLocation || 'Location not provided';
    }

    return (request as TowRequest).location || 'Location not provided';
  };

  const getRequestPhone = (request: AllRequests) => {
    if (['call', 'sms', 'chat'].includes((request as ContactRecord).type)) {
      return (request as ContactRecord).servicePhone;
    }

    if ('mechanicName' in request) {
      return request.mechanicPhone;
    }

    return (request as TowRequest).servicePhone;
  };

  const getRequestDate = (request: AllRequests) => {
    if (['call', 'sms', 'chat'].includes((request as ContactRecord).type)) {
      return (request as ContactRecord).timestamp;
    }

    if ('mechanicName' in request) {
      return request.createdAt;
    }

    return (request as TowRequest).timestamp;
  };

  const handleHomePress = () => {
    if (userRole === 'mechanic') {
      router.push('/mechanic-dashboard');
    } else if (userRole === 'tower') {
      router.push('/tower-dashboard');
    } else {
      router.push('/driver-dashboard');
    }
  };

  const handleDeleteRequest = (requestToDelete: AllRequests) => {
    if (requestToDelete.status === 'accepted') {
      Alert.alert('Cannot delete', 'Accepted requests cannot be deleted.');
      return;
    }

    Alert.alert(
      'Delete Request',
      'Are you sure you want to delete this request?',
      [
        { text: 'Cancel', onPress: () => {}, style: 'cancel' },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              const requestIdsToDelete = new Set([requestToDelete.id]);
              const towIdentity = isTowRequest(requestToDelete)
                ? getTowRequestIdentity(requestToDelete)
                : undefined;

              if (towIdentity) {
                allRequests.forEach((request) => {
                  if (isTowRequest(request) && getTowRequestIdentity(request) === towIdentity) {
                    requestIdsToDelete.add(request.id);
                  }
                });
              }

              setAllRequests((current) => current.filter((request) => request.id !== requestToDelete.id));
              setFilteredRequests((current) => current.filter((request) => request.id !== requestToDelete.id));
              for (const requestId of requestIdsToDelete) {
                await addHiddenRequestId(DRIVER_HIDDEN_REQUEST_IDS_KEY, requestId);
              }
              await removeRequestFromLocalHistory(requestIdsToDelete, towIdentity);
              await Promise.all(
                Array.from(requestIdsToDelete).map((requestId) =>
                  updateRequestHistoryStatus({
                    requestId,
                    status: 'cancelled',
                  })
                )
              );
              await loadRequests();
              Alert.alert('Success', 'Request deleted successfully');
            } catch (error) {
              console.error('Error deleting request:', error);
              Alert.alert('Error', 'Failed to delete request');
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  const updateLocalTowRequestStatus = async (
    requestId: string,
    status: 'accepted' | 'declined',
    acceptedBy?: string
  ) => {
    const towRequestsJson = await AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY);
    const towRequests: TowRequest[] = towRequestsJson ? JSON.parse(towRequestsJson) : [];
    const updatedTowRequests = towRequests.map((request) =>
      request.id === requestId
        ? {
            ...request,
            status,
            acceptedBy,
          }
        : request
    );

    await AsyncStorage.setItem(TOW_REQUESTS_STORAGE_KEY, JSON.stringify(updatedTowRequests));
  };

  const applyTowRequestStatus = (
    requestId: string,
    status: 'accepted' | 'declined',
    acceptedBy?: string
  ) => {
    const updateRequests = (requests: AllRequests[]) =>
      requests.map((request) =>
        request.id === requestId && (request as TowRequest).type === 'tow'
          ? {
              ...(request as TowRequest),
              status,
              acceptedBy,
            }
          : request
      );

    setAllRequests((current) => updateRequests(current));
    setFilteredRequests((current) => updateRequests(current));
  };

  const handleTowDecision = async (request: TowRequest, status: 'accepted' | 'declined') => {
    if (updatingRequestId) {
      return;
    }

    const acceptedBy = status === 'accepted' ? driverName : undefined;
    setUpdatingRequestId(request.id);
    applyTowRequestStatus(request.id, status, acceptedBy);

    try {
      await updateLocalTowRequestStatus(request.id, status, acceptedBy);
      const savedRequest = await updateRequestHistoryStatus({
        requestId: request.id,
        status,
        acceptedBy,
      });
      applyTowRequestStatus(request.id, savedRequest.status as 'accepted' | 'declined', savedRequest.acceptedBy || acceptedBy);
      await touchRequestOverview();
      Alert.alert('Success', status === 'accepted' ? 'Tow request accepted.' : 'Tow request declined.');
    } catch (error) {
      await loadRequests({ silent: true });
      const message = error instanceof Error ? error.message : 'Unable to update tow request.';
      Alert.alert('Error', message);
    } finally {
      setUpdatingRequestId(null);
    }
  };

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <View style={[styles.headerSection, { paddingHorizontal: responsive.isTablet ? 24 : 16 }]}>
        {userRole !== 'tower' && (
          <TouchableOpacity
            style={styles.menuIcon}
            onPress={() => setDrawerOpen(true)}
          >
            <AppIcon name="menu" size={26} color="#333" />
          </TouchableOpacity>
        )}
        <View style={styles.titleContainer}>
          <ThemedText style={[styles.titleText, { fontSize: responsive.isTablet ? 20 : responsive.isIOS ? 19 : 18 }]}>Your Requests</ThemedText>
          <ThemedText style={[styles.subtitleText, { fontSize: responsive.isTablet ? 13 : responsive.isIOS ? 13 : 12 }]}>
            {filteredRequests.length} of {allRequests.length} request{allRequests.length !== 1 ? 's' : ''}
          </ThemedText>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.scrollContainer}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: responsive.isTablet ? 24 : responsive.isIOS ? 16 : 12 },
        ]}
      >
        {loading ? (
          <View style={styles.emptyStateCard}>
            <ThemedText style={styles.emptyStateText}>Loading requests...</ThemedText>
          </View>
        ) : filteredRequests.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <AppIcon name="inbox" size={44} color="#999" style={styles.emptyEmoji} />
            <ThemedText style={styles.emptyStateText}>
              {allRequests.length === 0 ? 'No requests yet' : 'No matching requests'}
            </ThemedText>
            <ThemedText style={styles.emptyStateSubtext}>
              {allRequests.length === 0
                ? 'Your requests will appear here'
                : 'Try adjusting your filters'}
            </ThemedText>
          </View>
        ) : (
          filteredRequests.map((request) => {
            const isServiceRequest = 'mechanicName' in request;
            const isTowRequest = (request as TowRequest).type === 'tow';
            const contactType = (request as any).type;
            const isContactRecord = ['call', 'sms', 'chat'].includes(contactType);
            const canDelete = request.status !== 'accepted';
            const shouldBlink = !isContactRecord && isPendingStatus(request.status);

            return (
              <BlinkingCard 
                key={request.id} 
                active={shouldBlink}
                style={[
                  styles.requestCard,
                  { padding: responsive.isTablet ? 18 : responsive.isIOS ? 16 : 14 },
                ]}
              >
                <View style={styles.requestHeader}>
                  <View style={styles.requestTypeContainer}>
                    {isTowRequest ? (
                      <Image source={towImage} style={styles.requestTypeTowImage} resizeMode="cover" />
                    ) : (
                      <AppIcon name={contactType === 'call' ? 'phone' : contactType === 'sms' ? 'message' : contactType === 'chat' ? 'message' : 'wrench'} size={responsive.isTablet ? 28 : 24} color="#FF8C42" style={styles.requestTypeIcon} />
                    )}
                    <View style={styles.requestTypeText}>
                      <ThemedText style={[styles.requestTypeLabel, { fontSize: responsive.isTablet ? 13 : responsive.isIOS ? 13 : 12 }]}>
                        {isTowRequest
                          ? 'Tow Service'
                          : contactType === 'call'
                          ? 'Called Mechanic'
                          : contactType === 'sms'
                          ? 'SMS to Mechanic'
                          : contactType === 'chat'
                          ? 'Chat with Mechanic'
                          : 'Mechanic Service'}
                      </ThemedText>
                      <ThemedText style={[styles.requestProviderName, { fontSize: responsive.isTablet ? 16 : responsive.isIOS ? 15 : 14 }]}>
                        {isTowRequest
                          ? (request as TowRequest).serviceName
                          : isContactRecord
                          ? (request as any).serviceName
                          : (request as ServiceRequest).mechanicName}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={styles.headerActionContainer}>
                    <ThemedText style={[styles.statusBadge, getStatusColor(request.status), { fontSize: responsive.isTablet ? 12 : responsive.isIOS ? 12 : 11 }]}>
                      {getStatusText(request.status)}
                    </ThemedText>
                    {canDelete && (
                      <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => handleDeleteRequest(request)}
                      >
                        <AppIcon name="trash" size={18} color="#d32f2f" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <View style={styles.requestDetails}>
                  <View style={styles.detailRow}>
                    <ThemedText style={styles.detailLabel}>Request ID:</ThemedText>
                    <ThemedText style={styles.detailValue} selectable>
                      {request.id}
                    </ThemedText>
                  </View>

                  {isServiceRequest ? (
                    <>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Issue:</ThemedText>
                        <ThemedText style={styles.detailValue} numberOfLines={2}>
                          {(request as ServiceRequest).problemDescription}
                        </ThemedText>
                      </View>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Location:</ThemedText>
                        <LocationNameText
                          style={styles.detailValue}
                          numberOfLines={2}
                          location={getRequestLocation(request)}
                        />
                      </View>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Phone:</ThemedText>
                        <TouchableOpacity
                          style={styles.phoneContainer}
                          onPress={() => handleCopyPhone(getRequestPhone(request))}
                        >
                          <ThemedText style={styles.detailValue}>
                            {getRequestPhone(request)}
                          </ThemedText>
                          <AppIcon name="copy" size={15} color="#FF8C42" style={styles.copyIcon} />
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : isContactRecord ? (
                    <>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Issue:</ThemedText>
                        <ThemedText style={styles.detailValue} numberOfLines={2}>
                          {getRequestIssue(request)}
                        </ThemedText>
                      </View>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Location:</ThemedText>
                        <LocationNameText
                          style={styles.detailValue}
                          numberOfLines={2}
                          location={(request as any).location}
                        />
                      </View>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Phone:</ThemedText>
                        <TouchableOpacity
                          style={styles.phoneContainer}
                          onPress={() => handleCopyPhone(getRequestPhone(request))}
                        >
                          <ThemedText style={styles.detailValue}>
                            {getRequestPhone(request)}
                          </ThemedText>
                          <AppIcon name="copy" size={15} color="#FF8C42" style={styles.copyIcon} />
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Issue:</ThemedText>
                        <ThemedText style={styles.detailValue} numberOfLines={2}>
                          {getRequestIssue(request)}
                        </ThemedText>
                      </View>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Location:</ThemedText>
                        <LocationNameText
                          style={styles.detailValue}
                          numberOfLines={2}
                          location={(request as TowRequest).location}
                        />
                      </View>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Phone:</ThemedText>
                        <TouchableOpacity
                          style={styles.phoneContainer}
                          onPress={() => handleCopyPhone(getRequestPhone(request))}
                        >
                          <ThemedText style={styles.detailValue}>
                            {getRequestPhone(request)}
                          </ThemedText>
                          <AppIcon name="copy" size={15} color="#FF8C42" style={styles.copyIcon} />
                        </TouchableOpacity>
                      </View>
                    </>
                  )}

                  <View style={styles.detailRow}>
                    <ThemedText style={styles.detailLabel}>Date:</ThemedText>
                    <ThemedText style={styles.detailValue}>
                      {formatDate(getRequestDate(request))}
                    </ThemedText>
                  </View>
                </View>

                {userRole === 'tower' && isTowRequest && isPendingStatus(request.status) && (
                  <View style={styles.towDecisionRow}>
                    <TouchableOpacity
                      style={[
                        styles.towDecisionButton,
                        responsive.isIOS && styles.towDecisionButtonIOS,
                        styles.towAcceptButton,
                        updatingRequestId === request.id && styles.towDecisionButtonDisabled,
                      ]}
                      onPress={() => handleTowDecision(request as TowRequest, 'accepted')}
                      disabled={updatingRequestId === request.id}
                      activeOpacity={0.85}
                    >
                      <AppIcon name="check" size={18} color="#fff" />
                      <ThemedText style={styles.towAcceptButtonText}>
                        {updatingRequestId === request.id ? 'Updating...' : 'Accept'}
                      </ThemedText>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.towDecisionButton,
                        responsive.isIOS && styles.towDecisionButtonIOS,
                        styles.towDeclineButton,
                        updatingRequestId === request.id && styles.towDecisionButtonDisabled,
                      ]}
                      onPress={() => handleTowDecision(request as TowRequest, 'declined')}
                      disabled={updatingRequestId === request.id}
                      activeOpacity={0.85}
                    >
                      <AppIcon name="close" size={18} color="#d32f2f" />
                      <ThemedText style={styles.towDeclineButtonText}>Decline</ThemedText>
                    </TouchableOpacity>
                  </View>
                )}
              </BlinkingCard>
            );
          })
        )}
      </ScrollView>

      {/* Bottom Navigation */}
      <BottomNav onHomePress={handleHomePress} />

      {userRole !== 'tower' && (
        <Drawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          driverName={driverName}
          role={userRole}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 45,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  menuIcon: {
    padding: 8,
    marginRight: 10,
  },
  menuIconText: {
    fontSize: 24,
    color: '#000',
    fontWeight: 'bold',
  },
  titleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
  },
  subtitleText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#888',
    textAlign: 'center',
    marginTop: 2,
  },
  spacer: {
    width: 40,
  },
  clearButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#ffe0cc',
  },
  clearButtonText: {
    fontSize: 18,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 80,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  callRecordCard: {
    borderLeftColor: '#3498db',
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerActionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  requestTypeContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  requestTypeIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  requestTypeTowImage: {
    width: 34,
    height: 28,
    borderRadius: 7,
    marginRight: 10,
  },
  requestTypeText: {
    flex: 1,
  },
  requestTypeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  requestProviderName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginTop: 2,
  },
  requestDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    textAlign: 'right',
    marginLeft: 10,
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    overflow: 'hidden',
  },
  statusPending: {
    backgroundColor: '#FF8C42',
  },
  statusAccepted: {
    backgroundColor: '#27ae60',
  },
  statusCalled: {
    backgroundColor: '#3498db',
  },
  statusMessaged: {
    backgroundColor: '#8e44ad',
  },
  statusChat: {
    backgroundColor: '#16a085',
  },
  statusDeclined: {
    backgroundColor: '#e74c3c',
  },
  deleteButton: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#ffe0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButtonText: {
    fontSize: 16,
  },
  emptyStateCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 32,
    marginTop: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  emptyStateSubtext: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
  },
  towDecisionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  towDecisionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
  },
  towDecisionButtonIOS: {
    minHeight: 52,
    borderRadius: 12,
  },
  towAcceptButton: {
    backgroundColor: '#27ae60',
    borderColor: '#27ae60',
  },
  towDeclineButton: {
    backgroundColor: '#fff',
    borderColor: '#FECACA',
  },
  towDecisionButtonDisabled: {
    opacity: 0.7,
  },
  towAcceptButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  towDeclineButtonText: {
    color: '#d32f2f',
    fontSize: 14,
    fontWeight: '800',
  },
  phoneContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#fff9f0',
    borderWidth: 1,
    borderColor: '#FFE0CC',
  },
  copyIcon: {
    fontSize: 14,
    marginLeft: 6,
    color: '#FF8C42',
  },
  headerActionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  filterButton: {
    padding: 8,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  filterButtonText: {
    fontSize: 18,
  },
  filterPanel: {
    backgroundColor: '#f8f9fa',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 12,
  },
  filterGroup: {
    gap: 8,
  },
  filterGroupLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    paddingHorizontal: 4,
  },
  filterOptionsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  filterOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  filterOptionActive: {
    backgroundColor: '#FF8C42',
    borderColor: '#FF8C42',
  },
  filterOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  filterOptionTextActive: {
    color: '#fff',
  },
});


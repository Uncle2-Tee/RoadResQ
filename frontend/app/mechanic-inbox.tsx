import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, View } from 'react-native';
import { AppIcon } from '../components/app-icon';
import { BlinkingCard } from '../components/blinking-card';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { LocationNameText } from '../components/location-name-text';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import {
  getMechanicShops,
  getRequestHistory,
  updateRequestHistoryStatus,
  type RequestHistoryItem,
} from '../services/api-client';
import {
  addHiddenRequestId,
  getHiddenRequestIds,
  isRequestVisible,
  MECHANIC_HIDDEN_REQUEST_IDS_KEY,
  touchRequestOverview,
  subscribeToRequestOverviewChanges,
} from '../services/request-sync';

const towImage = require('../assets/images/tow.jpg');
import { stopMechanicRequestSound } from '../services/notification-sound';

type RequestStatus = 'pending' | 'accepted' | 'declined' | 'confirmed';

interface TowRequest {
  id: string;
  type: 'tow';
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

interface ServiceRequest {
  id: string;
  type?: 'service';
  mechanicId: string;
  mechanicName: string;
  mechanicPhone: string;
  driverName: string;
  driverPhone?: string;
  problemDescription: string;
  driverLocation?: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
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
  price?: number;
  currency?: string;
  estimatedTime?: number;
  timestamp: string;
  status: 'called' | 'messaged' | 'chat';
  rating?: number;
  reviews?: number;
}

type AllRequests = TowRequest | ServiceRequest | ContactRecord;

const MECHANIC_NAME_KEY = 'mechanicName';
const USER_ID_KEY = 'userId';
const SERVICE_REQUESTS_STORAGE_KEY = 'serviceRequests';
const TOW_REQUESTS_STORAGE_KEY = 'towRequests';
const CONTACT_REQUESTS_STORAGE_KEY = 'contactRequests';
const CONTACT_REQUEST_TYPES = ['call', 'sms', 'chat'];

const isPendingRequestStatus = (status?: string) => {
  const normalizedStatus = (status || '').toLowerCase();
  return normalizedStatus === 'pending' || normalizedStatus === 'confirmed';
};

const isCallOnlyHistoryRequest = (request: AllRequests) =>
  ((request as ContactRecord).type === 'call') ||
  ((request as TowRequest).type === 'tow' &&
    (request as TowRequest).problemDescription?.trim().toLowerCase() === 'called');

const mapDatabaseRequest = (request: RequestHistoryItem): AllRequests => {
  if (request.type === 'tow') {
    return {
      id: request.requestId,
      type: 'tow',
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

  if (CONTACT_REQUEST_TYPES.includes(request.type)) {
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
    type: 'service',
    mechanicId: request.mechanicId || '',
    mechanicName: request.providerName,
    mechanicPhone: request.providerPhone || '',
    driverName: request.driverName,
    driverPhone: request.driverPhone || undefined,
    problemDescription: request.problemDescription || 'No issue description provided',
    driverLocation: request.driverLocation || undefined,
    status: request.status as RequestStatus,
    createdAt: request.requestedAt,
    updatedAt: request.updatedAt,
  };
};

export default function MechanicInboxScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [mechanicName, setMechanicName] = useState((params.mechanicName as string) || 'Mechanic');
  const [allRequests, setAllRequests] = useState<AllRequests[]>([]);
  const [loading, setLoading] = useState(true);
  const seenPendingRequestIdsRef = useRef<Set<string>>(new Set());

  const loadAllRequests = async (options: { silent?: boolean } = {}) => {
    try {
      if (!options.silent) {
        setLoading(true);
      }
      const paramName = typeof params.mechanicName === 'string' ? params.mechanicName.trim() : '';
      const [savedMechanicName, savedUserId] = await Promise.all([
        AsyncStorage.getItem(MECHANIC_NAME_KEY),
        AsyncStorage.getItem(USER_ID_KEY),
      ]);

      const resolvedMechanicName = paramName || savedMechanicName?.trim() || 'Mechanic';
      setMechanicName(resolvedMechanicName);

      const hiddenRequestIdSet = await getHiddenRequestIds();

      const providerNames = new Set<string>();
      if (resolvedMechanicName && resolvedMechanicName !== 'Mechanic') {
        providerNames.add(resolvedMechanicName);
      }

      const shops = await getMechanicShops({ forceRefresh: options.silent }).catch(() => []);
      shops
        .filter((shop) =>
          shop.providerType !== 'tow' &&
          (savedUserId
            ? shop.mechanicId === savedUserId
            : shop.shopName.trim().toLowerCase() === resolvedMechanicName.toLowerCase())
        )
        .forEach((shop) => providerNames.add(shop.shopName));

      if (!savedUserId && providerNames.size === 0) {
        setAllRequests([]);
        seenPendingRequestIdsRef.current = new Set();
        return;
      }

      const applyRequests = (requests: AllRequests[]) => {
        const visibleRequests = requests.filter((request) => !isCallOnlyHistoryRequest(request));
        setAllRequests(visibleRequests);

        const pendingRequests = visibleRequests.filter((item) => {
          return !CONTACT_REQUEST_TYPES.includes((item as ContactRecord).type) && isPendingRequestStatus(item.status);
        });

        seenPendingRequestIdsRef.current = new Set(pendingRequests.map((item) => item.id));
      };

      const [localRequestsJson, localContactRequestsJson] = await Promise.all([
        AsyncStorage.getItem(SERVICE_REQUESTS_STORAGE_KEY),
        AsyncStorage.getItem(CONTACT_REQUESTS_STORAGE_KEY),
      ]);
      const localRequests: ServiceRequest[] = localRequestsJson
        ? (JSON.parse(localRequestsJson) as ServiceRequest[])
        : [];
      const localContactRequests: ContactRecord[] = localContactRequestsJson
        ? (JSON.parse(localContactRequestsJson) as ContactRecord[])
        : [];

      if (!options.silent) {
        const localVisibleRequests: AllRequests[] = [
          ...localRequests.filter((request) => {
            if (savedUserId && request.mechanicId === savedUserId) {
              return true;
            }

            return providerNames.has(request.mechanicName);
          }),
          ...localContactRequests.filter((request) => {
            if (savedUserId && request.mechanicId === savedUserId) {
              return true;
            }

            return providerNames.has(request.serviceName);
          }),
        ].filter((request) => isRequestVisible(request.id, request.status, hiddenRequestIdSet));

        applyRequests(localVisibleRequests);
        setLoading(false);
      }

      let loadedFromDatabase = false;
      const databaseRequests = await getRequestHistory({
        mechanicId: savedUserId,
        providerNames: Array.from(providerNames),
        forceRefresh: options.silent,
      })
        .then((requests) => {
          loadedFromDatabase = true;
          return requests;
        })
        .catch(() => [] as RequestHistoryItem[]);

      const requestMap = new Map<string, AllRequests>();
      databaseRequests
        .map(mapDatabaseRequest)
        .filter((request) => isRequestVisible(request.id, request.status, hiddenRequestIdSet))
        .forEach((request) => {
          requestMap.set(request.id, request);
        });

      if (loadedFromDatabase) {
        const databaseRequestIds = new Set(databaseRequests.map((request) => request.requestId));
        const prunedLocalRequests = localRequests.filter((request) => {
          const belongsToMechanic = savedUserId
            ? request.mechanicId === savedUserId
            : providerNames.has(request.mechanicName);

          return !belongsToMechanic || databaseRequestIds.has(request.id);
        });

        if (prunedLocalRequests.length !== localRequests.length) {
          await AsyncStorage.setItem(SERVICE_REQUESTS_STORAGE_KEY, JSON.stringify(prunedLocalRequests));
        }

        localContactRequests
          .filter((request) => {
            if (savedUserId && request.mechanicId === savedUserId) {
              return true;
            }

            return providerNames.has(request.serviceName);
          })
          .filter((request) => !databaseRequestIds.has(request.id))
          .filter((request) => isRequestVisible(request.id, request.status, hiddenRequestIdSet))
          .forEach((request) => {
            requestMap.set(request.id, request);
          });
      } else {
        localRequests
          .filter((request) => {
            if (savedUserId && request.mechanicId === savedUserId) {
              return true;
            }

            return providerNames.has(request.mechanicName);
          })
          .filter((request) => isRequestVisible(request.id, request.status, hiddenRequestIdSet))
          .forEach((request) => {
            requestMap.set(request.id, request);
          });
        localContactRequests
          .filter((request) => {
            if (savedUserId && request.mechanicId === savedUserId) {
              return true;
            }

            return providerNames.has(request.serviceName);
          })
          .filter((request) => isRequestVisible(request.id, request.status, hiddenRequestIdSet))
          .forEach((request) => {
            requestMap.set(request.id, request);
          });
      }

      const uniqueRequests = Array.from(requestMap.values());
      applyRequests(uniqueRequests);
    } catch (error) {
      console.error('Error loading requests:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Unable to load requests');
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadAllRequests();
      const refreshTimer = setInterval(() => {
        loadAllRequests({ silent: true });
      }, 2000);

      return () => {
        clearInterval(refreshTimer);
      };
    }, [params.mechanicName])
  );

  useEffect(() => {
    const unsubscribe = subscribeToRequestOverviewChanges(() => {
      loadAllRequests({ silent: true });
    });
    return () => {
      unsubscribe();
    };
  }, [loadAllRequests]);

  const updateLocalRequestStatus = async (requestId: string, status: RequestStatus, acceptedBy?: string) => {
    const [requestsJson, towRequestsJson] = await Promise.all([
      AsyncStorage.getItem(SERVICE_REQUESTS_STORAGE_KEY),
      AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY),
    ]);
    const requests: ServiceRequest[] = requestsJson
      ? (JSON.parse(requestsJson) as ServiceRequest[])
      : [];
    const towRequests: TowRequest[] = towRequestsJson
      ? (JSON.parse(towRequestsJson) as TowRequest[])
      : [];
    const updatedRequests = requests.map((request) =>
      request.id === requestId
        ? {
            ...request,
            status,
            updatedAt: new Date().toISOString(),
          }
        : request
    );
    const updatedTowRequests = towRequests.map((request) =>
      request.id === requestId
        ? {
            ...request,
            status,
            acceptedBy,
          }
        : request
    );

    await AsyncStorage.multiSet([
      [SERVICE_REQUESTS_STORAGE_KEY, JSON.stringify(updatedRequests)],
      [TOW_REQUESTS_STORAGE_KEY, JSON.stringify(updatedTowRequests)],
    ]);
  };

  const applyRequestStatusToList = (
    requestId: string,
    status: RequestStatus,
    acceptedBy?: string
  ) => {
    setAllRequests((currentRequests) =>
      currentRequests.map((request) => {
        if (request.id !== requestId || CONTACT_REQUEST_TYPES.includes((request as ContactRecord).type)) {
          return request;
        }

        if ((request as TowRequest).type === 'tow') {
          return {
            ...(request as TowRequest),
            status,
            acceptedBy,
          };
        }

        return {
          ...(request as ServiceRequest),
          status,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  };

  const handleAcceptRequest = async (requestId: string) => {
    try {
      stopMechanicRequestSound();
      applyRequestStatusToList(requestId, 'accepted', mechanicName);
      await updateLocalRequestStatus(requestId, 'accepted', mechanicName);
      await touchRequestOverview();
      await updateRequestHistoryStatus({
        requestId,
        status: 'accepted',
        acceptedBy: mechanicName,
      });
      await touchRequestOverview();

      Alert.alert('Success', 'Request accepted!');
      await loadAllRequests();
    } catch (error) {
      await loadAllRequests();
      Alert.alert('Error', 'Unable to accept request');
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    Alert.alert(
      'Decline Request',
      'Are you sure you want to decline this request?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            try {
              stopMechanicRequestSound();
              applyRequestStatusToList(requestId, 'declined');
              await updateLocalRequestStatus(requestId, 'declined');
              await touchRequestOverview();
              await updateRequestHistoryStatus({
                requestId,
                status: 'declined',
              });
              await touchRequestOverview();

              Alert.alert('Success', 'Request declined');
              await loadAllRequests();
            } catch (error) {
              await loadAllRequests();
              Alert.alert('Error', 'Unable to decline request');
            }
          },
        },
      ]
    );
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
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setAllRequests((current) => current.filter((request) => request.id !== requestToDelete.id));
              await updateRequestHistoryStatus({
                requestId: requestToDelete.id,
                status: 'cancelled',
              });
              await addHiddenRequestId(MECHANIC_HIDDEN_REQUEST_IDS_KEY, requestToDelete.id);
              await loadAllRequests();
              Alert.alert('Success', 'Request deleted');
            } catch (error) {
              Alert.alert('Error', 'Unable to delete request');
            }
          },
        },
      ]
    );
  };

  const getStatusColor = (request: AllRequests) => {
    if (CONTACT_REQUEST_TYPES.includes((request as ContactRecord).type)) {
      const status = (request as ContactRecord).status;
      if (status === 'called') return styles.statusCalled;
      if (status === 'messaged') return styles.statusMessaged;
      return styles.statusChat;
    }

    if ((request as TowRequest).type === 'tow') {
      const status = (request as TowRequest).status;
      if (status === 'accepted') return styles.statusAccepted;
      if (status === 'declined') return styles.statusDeclined;
      return styles.statusPending;
    }
    const status = (request as ServiceRequest).status;
    if (status === 'accepted') return styles.statusAccepted;
    if (status === 'declined') return styles.statusDeclined;
    return styles.statusPending;
  };

  const isPending = (request: AllRequests) => {
    if (CONTACT_REQUEST_TYPES.includes((request as ContactRecord).type)) {
      return false;
    }

    return isPendingRequestStatus(request.status);
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.navBar}>
        <View style={styles.navContent}>
          <ThemedText type="title" style={styles.navTitle}>Service Requests</ThemedText>
          <ThemedText style={styles.navSubtitle}>Welcome, {mechanicName}</ThemedText>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.emptyCard}>
            <ThemedText style={styles.emptyText}>Loading requests...</ThemedText>
          </View>
        ) : allRequests.length === 0 ? (
          <View style={styles.emptyCard}>
            <AppIcon name="inbox" size={64} color="#999" style={styles.emptyEmoji} />
            <ThemedText style={styles.emptyText}>No service requests yet.</ThemedText>
            <ThemedText style={styles.emptySubtext}>
              New requests will appear here when drivers submit them
            </ThemedText>
          </View>
        ) : (
          allRequests.map((request) => {
            const isTow = (request as TowRequest).type === 'tow';
            const isContact = CONTACT_REQUEST_TYPES.includes((request as ContactRecord).type);
            const contactType = isContact ? (request as ContactRecord).type : null;
            const isServicePending = isPending(request);
            const canDelete = request.status !== 'accepted';

            return (
              <BlinkingCard key={request.id} active={isServicePending} style={styles.requestCard}>
                <View style={styles.requestHeader}>
                  <View style={styles.requestTitleContainer}>
                    {isTow ? (
                      <Image source={towImage} style={styles.requestTowImage} resizeMode="cover" />
                    ) : (
                      <AppIcon name={contactType === 'call' ? 'phone' : contactType === 'sms' ? 'message' : contactType === 'chat' ? 'message' : 'wrench'} size={28} color="#FF8C42" style={styles.requestIcon} />
                    )}
                    <View style={styles.requestTitleText}>
                      <ThemedText style={styles.requestTitle}>
                        {isTow
                          ? (request as TowRequest).serviceName
                          : isContact
                          ? (request as ContactRecord).driverName
                          : (request as ServiceRequest).driverName}
                      </ThemedText>
                      <ThemedText style={styles.requestType}>
                        {isTow
                          ? 'Tow Service'
                          : contactType === 'call'
                          ? 'Mechanic Call'
                          : contactType === 'sms'
                          ? 'Mechanic SMS'
                          : contactType === 'chat'
                          ? 'Mechanic Chat'
                          : 'Mechanic Service'}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={styles.headerActions}>
                    <ThemedText style={[styles.statusPill, getStatusColor(request)]}>
                      {isContact
                        ? (request as ContactRecord).status.toUpperCase()
                        : isTow
                        ? (request as TowRequest).status.toUpperCase()
                        : (request as ServiceRequest).status.toUpperCase()}
                    </ThemedText>
                    {canDelete && (
                      <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => handleDeleteRequest(request)}
                      >
                        <AppIcon name="trash" size={15} color="#c62828" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <View style={styles.requestDetails}>
                  {isContact ? (
                    <>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Issue:</ThemedText>
                        <ThemedText style={styles.detailValue}>
                          {(request as ContactRecord).problemDescription ||
                            ((request as ContactRecord).type === 'call'
                              ? 'Called'
                              : (request as ContactRecord).type === 'sms'
                              ? 'No SMS message provided'
                              : 'Chat with mechanic')}
                        </ThemedText>
                      </View>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Location:</ThemedText>
                        <LocationNameText
                          style={styles.detailValue}
                          numberOfLines={2}
                          location={(request as ContactRecord).location}
                        />
                      </View>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Phone:</ThemedText>
                        <ThemedText style={styles.detailValue}>
                          {(request as ContactRecord).driverPhone || (request as ContactRecord).servicePhone}
                        </ThemedText>
                      </View>
                    </>
                  ) : isTow ? (
                    <>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Issue:</ThemedText>
                        <ThemedText style={styles.detailValue}>
                          {(request as TowRequest).problemDescription || 'No issue description provided'}
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
                        <ThemedText style={styles.detailValue}>
                          {(request as TowRequest).servicePhone}
                        </ThemedText>
                      </View>
                    </>
                  ) : (
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
                          location={(request as ServiceRequest).driverLocation}
                        />
                      </View>
                      <View style={styles.detailRow}>
                        <ThemedText style={styles.detailLabel}>Phone:</ThemedText>
                        <ThemedText style={styles.detailValue}>
                          {(request as ServiceRequest).driverPhone || (request as ServiceRequest).mechanicPhone}
                        </ThemedText>
                      </View>
                    </>
                  )}

                  <View style={styles.detailRow}>
                    <ThemedText style={styles.detailLabel}>Date:</ThemedText>
                    <ThemedText style={styles.detailValue}>
                      {new Date(
                        (request as any).timestamp || (request as any).createdAt
                      ).toLocaleString()}
                    </ThemedText>
                  </View>
                </View>

                {isServicePending && (
                  <View style={styles.actionButtons}>
                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={() => handleAcceptRequest(request.id)}
                    >
                      <ThemedText style={styles.acceptButtonText}>Accept</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.declineButton}
                      onPress={() => handleDeclineRequest(request.id)}
                    >
                      <ThemedText style={styles.declineButtonText}>Decline</ThemedText>
                    </TouchableOpacity>
                  </View>
                )}
              </BlinkingCard>
            );
          })
        )}
      </ScrollView>

      {/* Home Button */}
      <View style={styles.homeButtonContainer}>
        <TouchableOpacity onPress={() => router.push('/mechanic-dashboard')}>
          <View style={styles.homeButtonContent}>
            <AppIcon name="home" size={32} color="#FF8C42" style={styles.homeButtonIcon} />
            <ThemedText style={styles.homeButtonLabel}>Home</ThemedText>
          </View>
        </TouchableOpacity>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 42,
    paddingBottom: 16,
    backgroundColor: '#FF8C42',
    borderBottomWidth: 2,
    borderBottomColor: '#FF7B2B',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  navContent: {
    flex: 1,
    alignItems: 'center',
  },
  navTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  navSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 4,
    fontWeight: '500',
    textAlign: 'center',
  },
  homeButtonContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  homeButtonContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeButtonIcon: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FF8C42',
    marginBottom: 4,
  },
  homeButtonLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FF8C42',
  },
  homeButtonText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FF8C42',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 80,
    alignItems: 'center',
  },
  emptyCard: {
    marginTop: 60,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 300,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
    width: '100%',
    maxWidth: 320,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  requestTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginRight: 8,
  },
  requestIcon: {
    fontSize: 28,
  },
  requestTowImage: {
    width: 36,
    height: 30,
    borderRadius: 7,
  },
  requestTitleText: {
    flex: 1,
  },
  requestTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  requestType: {
    fontSize: 12,
    color: '#999',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPill: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    overflow: 'hidden',
  },
  deleteButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFEBEE',
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  deleteButtonText: {
    fontSize: 15,
  },
  statusPending: {
    backgroundColor: '#FFF3E0',
    color: '#E65100',
  },
  statusAccepted: {
    backgroundColor: '#E8F5E9',
    color: '#2E7D32',
  },
  statusCalled: {
    backgroundColor: '#E3F2FD',
    color: '#1565C0',
  },
  statusMessaged: {
    backgroundColor: '#F3E5F5',
    color: '#6A1B9A',
  },
  statusChat: {
    backgroundColor: '#E0F2F1',
    color: '#00695C',
  },
  statusDeclined: {
    backgroundColor: '#FFEBEE',
    color: '#C62828',
  },
  requestDetails: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
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
    width: '30%',
  },
  detailValue: {
    fontSize: 12,
    color: '#333',
    flex: 1,
    textAlign: 'right',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#27ae60',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  acceptButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  declineButton: {
    flex: 1,
    backgroundColor: '#c0392b',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  declineButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});


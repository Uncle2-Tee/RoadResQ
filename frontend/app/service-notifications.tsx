import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    Alert,
    Image,
    RefreshControl,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import { AppIcon } from '../components/app-icon';
import { BlinkingCard } from '../components/blinking-card';
import { BottomNav } from '../components/bottom-nav';
import { Drawer } from '../components/drawer';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { LocationNameText } from '../components/location-name-text';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { getRequestHistory, updateRequestHistoryStatus, type RequestHistoryItem } from '../services/api-client';

const towImage = require('../assets/images/tow.jpg');
import { stopMechanicRequestSound } from '../services/notification-sound';
import { getHiddenRequestIds, isRequestVisible, touchRequestOverview } from '../services/request-sync';

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
  isNew?: boolean;
}

interface ServiceRequest {
  id: string;
  type?: 'service';
  mechanicId: string;
  mechanicName: string;
  mechanicPhone: string;
  driverName: string;
  problemDescription: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  isNew?: boolean;
}

type AllRequests = TowRequest | ServiceRequest;

const REQUESTS_STORAGE_KEY = 'serviceRequests';
const TOW_REQUESTS_STORAGE_KEY = 'towRequests';
const VIEWED_REQUESTS_KEY = 'viewedRequestIds';

const isPendingRequestStatus = (status?: string) => {
  const normalizedStatus = (status || '').toLowerCase();
  return normalizedStatus === 'pending' || normalizedStatus === 'confirmed';
};

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

  return {
    id: request.requestId,
    type: 'service',
    mechanicId: request.mechanicId || '',
    mechanicName: request.providerName,
    mechanicPhone: request.providerPhone || '',
    driverName: request.driverName,
    problemDescription: request.problemDescription || 'No issue description provided',
    status: request.status as RequestStatus,
    createdAt: request.requestedAt,
    updatedAt: request.updatedAt,
  };
};

export default function ServiceNotificationsScreen() {
  const params = useLocalSearchParams();
  const mechanicName = (params.mechanicName as string) || 'Mechanic';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<AllRequests[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const formatTime = (timestamp: string) => {
    const now = new Date();
    const requestTime = new Date(timestamp);
    const diffMinutes = Math.floor((now.getTime() - requestTime.getTime()) / (1000 * 60));

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const loadPendingRequests = useCallback(async () => {
    try {
      // Load viewed request IDs
      const viewedJson = await AsyncStorage.getItem(VIEWED_REQUESTS_KEY);
      const viewedIds: Record<string, boolean> = viewedJson ? JSON.parse(viewedJson) : {};
      const hiddenRequestIdSet = await getHiddenRequestIds();

      // Load tow requests
      const towRequestsJson = await AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY);
      const towRequests: TowRequest[] = towRequestsJson ? JSON.parse(towRequestsJson) : [];

      // Load service requests
      const serviceRequestsJson = await AsyncStorage.getItem(REQUESTS_STORAGE_KEY);
      const serviceRequests: ServiceRequest[] = serviceRequestsJson
        ? JSON.parse(serviceRequestsJson)
        : [];

      let loadedFromDatabase = false;
      const databaseRequests = await getRequestHistory({
        providerName: mechanicName,
        forceRefresh: true,
      })
        .then((requests) => {
          loadedFromDatabase = true;
          return requests;
        })
        .catch(() => [] as RequestHistoryItem[]);

      // Filter only pending requests and mark as new
      const pendingFromDatabase = databaseRequests
        .filter(
          (request) =>
            request.type !== 'call' &&
            !(request.type === 'tow' && request.problemDescription?.trim().toLowerCase() === 'called')
        )
        .map(mapDatabaseRequest)
        .filter((req) => {
          const status = (req as TowRequest).type === 'tow'
            ? (req as TowRequest).status
            : (req as ServiceRequest).status;
          return isPendingRequestStatus(status) && isRequestVisible(req.id, status, hiddenRequestIdSet);
        })
        .map((req) => ({
          ...req,
          isNew: !viewedIds[req.id],
        }));

      let combined: AllRequests[];

      if (loadedFromDatabase) {
        const databaseRequestIds = new Set(databaseRequests.map((request) => request.requestId));
        const prunedServiceRequests = serviceRequests.filter((request) => databaseRequestIds.has(request.id));
        const prunedTowRequests = towRequests.filter((request) => databaseRequestIds.has(request.id));

        if (prunedServiceRequests.length !== serviceRequests.length) {
          await AsyncStorage.setItem(REQUESTS_STORAGE_KEY, JSON.stringify(prunedServiceRequests));
        }
        if (prunedTowRequests.length !== towRequests.length) {
          await AsyncStorage.setItem(TOW_REQUESTS_STORAGE_KEY, JSON.stringify(prunedTowRequests));
        }

        combined = pendingFromDatabase;
      } else {
        const pendingTow = towRequests
          .filter(
            (req) =>
              req.problemDescription?.trim().toLowerCase() !== 'called' &&
              isPendingRequestStatus(req.status) &&
              isRequestVisible(req.id, req.status, hiddenRequestIdSet)
          )
          .map((req) => ({
            ...req,
            type: 'tow' as const,
            isNew: !viewedIds[req.id],
          }));

        const pendingService = serviceRequests
          .filter((req) => isPendingRequestStatus(req.status) && isRequestVisible(req.id, req.status, hiddenRequestIdSet))
          .map((req) => ({
            ...req,
            type: 'service' as const,
            isNew: !viewedIds[req.id],
          }));

        combined = [...pendingTow, ...pendingService];
      }

      // Combine and sort by timestamp (newest first)
      const sorted = combined.sort((a, b) => {
        const timeA = new Date((a as any).timestamp || (a as any).createdAt).getTime();
        const timeB = new Date((b as any).timestamp || (b as any).createdAt).getTime();
        return timeB - timeA;
      });

      setPendingRequests(sorted);

      // Count unread
      const unread = sorted.filter((req) => req.isNew).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Error loading pending requests:', error);
    }
  }, [mechanicName]);

  useFocusEffect(
    useCallback(() => {
      loadPendingRequests();
      const refreshTimer = setInterval(loadPendingRequests, 2000);

      return () => {
        clearInterval(refreshTimer);
      };
    }, [loadPendingRequests])
  );

  const markAsViewed = async (requestId: string) => {
    try {
      const viewedJson = await AsyncStorage.getItem(VIEWED_REQUESTS_KEY);
      const viewedIds = viewedJson ? JSON.parse(viewedJson) : {};
      viewedIds[requestId] = true;
      await AsyncStorage.setItem(VIEWED_REQUESTS_KEY, JSON.stringify(viewedIds));
      loadPendingRequests();
    } catch (error) {
      console.error('Error marking request as viewed:', error);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    Alert.alert(
      'Accept Request',
      'Are you sure you want to accept this request?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          style: 'default',
          onPress: async () => {
            try {
              stopMechanicRequestSound();
              const isTow = pendingRequests.find((r) => r.id === requestId)?.type === 'tow';
              setPendingRequests((current) => current.filter((request) => request.id !== requestId));

              if (isTow) {
                const towRequestsJson = await AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY);
                const towRequests = towRequestsJson ? JSON.parse(towRequestsJson) : [];
                const updated = towRequests.map((r: any) =>
                  r.id === requestId ? { ...r, status: 'accepted', acceptedBy: mechanicName } : r
                );
                await AsyncStorage.setItem(TOW_REQUESTS_STORAGE_KEY, JSON.stringify(updated));
              } else {
                const serviceRequestsJson = await AsyncStorage.getItem(REQUESTS_STORAGE_KEY);
                const serviceRequests = serviceRequestsJson ? JSON.parse(serviceRequestsJson) : [];
                const updated = serviceRequests.map((r: any) =>
                  r.id === requestId
                    ? { ...r, status: 'accepted', updatedAt: new Date().toISOString() }
                    : r
                );
                await AsyncStorage.setItem(REQUESTS_STORAGE_KEY, JSON.stringify(updated));
              }

              await touchRequestOverview();
              await updateRequestHistoryStatus({
                requestId,
                status: 'accepted',
                acceptedBy: mechanicName,
              });
              Alert.alert('Success', 'Request accepted! You are now assigned to this job.');
              loadPendingRequests();
            } catch (error) {
              console.error('Error accepting request:', error);
              Alert.alert('Error', 'Unable to accept request. Please try again.');
            }
          },
        },
      ]
    );
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
              const isTow = pendingRequests.find((r) => r.id === requestId)?.type === 'tow';
              setPendingRequests((current) => current.filter((request) => request.id !== requestId));

              if (isTow) {
                const towRequestsJson = await AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY);
                const towRequests = towRequestsJson ? JSON.parse(towRequestsJson) : [];
                const updated = towRequests.map((r: any) =>
                  r.id === requestId ? { ...r, status: 'declined' } : r
                );
                await AsyncStorage.setItem(TOW_REQUESTS_STORAGE_KEY, JSON.stringify(updated));
              } else {
                const serviceRequestsJson = await AsyncStorage.getItem(REQUESTS_STORAGE_KEY);
                const serviceRequests = serviceRequestsJson ? JSON.parse(serviceRequestsJson) : [];
                const updated = serviceRequests.map((r: any) =>
                  r.id === requestId
                    ? { ...r, status: 'declined', updatedAt: new Date().toISOString() }
                    : r
                );
                await AsyncStorage.setItem(REQUESTS_STORAGE_KEY, JSON.stringify(updated));
              }

              await touchRequestOverview();
              await updateRequestHistoryStatus({
                requestId,
                status: 'declined',
              });
              Alert.alert('Success', 'Request declined.');
              loadPendingRequests();
            } catch (error) {
              console.error('Error declining request:', error);
              Alert.alert('Error', 'Unable to decline request. Please try again.');
            }
          },
        },
      ]
    );
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadPendingRequests().finally(() => setRefreshing(false));
  }, [loadPendingRequests]);

  const renderRequestCard = (request: AllRequests) => {
    const isTow = request.type === 'tow';
    const isNew = request.isNew === true;
    const towReq = request as TowRequest;
    const serviceReq = request as ServiceRequest;
    const timestamp = isTow ? towReq.timestamp : serviceReq.createdAt;

    return (
      <BlinkingCard key={request.id} active={true}>
      <View
        key={request.id}
        style={[
          styles.notificationCard,
          isNew && styles.notificationCardNew,
        ]}
      >
        {isNew && <View style={styles.newBadge} />}

        <View style={styles.cardHeader}>
          <View style={styles.iconTitleContainer}>
            {isTow ? (
              <Image source={towImage} style={styles.requestTowImage} resizeMode="cover" />
            ) : (
              <AppIcon name="wrench" size={24} color="#FF8C42" style={styles.requestIcon} />
            )}
            <View style={styles.titleContent}>
              <ThemedText style={styles.requestType}>
                {isTow ? 'Tow Service Request' : 'Mechanic Service Request'}
              </ThemedText>
              <ThemedText style={styles.timestamp}>{formatTime(timestamp)}</ThemedText>
            </View>
          </View>
          {isNew && <View style={styles.newDot} />}
        </View>

        <View style={styles.cardContent}>
          {isTow ? (
            <>
              <View style={styles.detailRow}>
                <ThemedText style={styles.label}>Issue</ThemedText>
                <ThemedText style={styles.value}>
                  {towReq.problemDescription || 'No issue description provided'}
                </ThemedText>
              </View>
              <View style={styles.detailRow}>
                <ThemedText style={styles.label}>Location</ThemedText>
                <LocationNameText style={styles.value} location={towReq.location} />
              </View>
              <View style={styles.detailRow}>
                <ThemedText style={styles.label}>Phone</ThemedText>
                <ThemedText style={styles.value}>{towReq.servicePhone}</ThemedText>
              </View>
              <View style={styles.detailRow}>
                <ThemedText style={styles.label}>Date</ThemedText>
                <ThemedText style={styles.value}>{new Date(towReq.timestamp).toLocaleString()}</ThemedText>
              </View>
            </>
          ) : (
            <>
              <View style={styles.detailRow}>
                <ThemedText style={styles.label}>Issue</ThemedText>
                <ThemedText style={styles.value}>{serviceReq.problemDescription}</ThemedText>
              </View>
              <View style={styles.detailRow}>
                <ThemedText style={styles.label}>Location</ThemedText>
                <LocationNameText
                  style={styles.value}
                  location={(serviceReq as any).driverLocation}
                />
              </View>
              <View style={styles.detailRow}>
                <ThemedText style={styles.label}>Phone</ThemedText>
                <ThemedText style={styles.value}>{(serviceReq as any).driverPhone || serviceReq.mechanicPhone}</ThemedText>
              </View>
              <View style={styles.detailRow}>
                <ThemedText style={styles.label}>Date</ThemedText>
                <ThemedText style={styles.value}>{new Date(serviceReq.createdAt).toLocaleString()}</ThemedText>
              </View>
            </>
          )}
        </View>

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
      </View>
      </BlinkingCard>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} driverName={mechanicName} role="mechanic" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => setDrawerOpen(true)} style={styles.menuButton}>
          <AppIcon name="menu" size={24} color="#333" />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Service Requests</ThemedText>
        {unreadCount > 0 && (
          <View style={styles.notificationBadge}>
            <ThemedText style={styles.notificationBadgeText}>{unreadCount}</ThemedText>
          </View>
        )}
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.subheader}>
        <ThemedText style={styles.subheaderText}>
          Welcome, {mechanicName}
        </ThemedText>
        {unreadCount > 0 && (
          <ThemedText style={styles.unreadText}>
            {unreadCount} new {unreadCount === 1 ? 'request' : 'requests'}
          </ThemedText>
        )}
      </View>

      {pendingRequests.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <AppIcon name="inbox" size={48} color="#999" style={styles.emptyText} />
          <ThemedText style={styles.emptyTitle}>No pending requests</ThemedText>
          <ThemedText style={styles.emptySubtitle}>
            New service requests will appear here
          </ThemedText>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.requestsList}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {pendingRequests.map(renderRequestCard)}
          <View style={styles.bottomPadding} />
        </ScrollView>
      )}

      <BottomNav />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuButton: {
    padding: 8,
  },
  menuIcon: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  notificationBadge: {
    backgroundColor: '#FF8C42',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 24,
    alignItems: 'center',
  },
  notificationBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  subheader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  subheaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  unreadText: {
    fontSize: 12,
    color: '#FF8C42',
    fontWeight: '600',
    marginTop: 4,
  },
  requestsList: {
    flex: 1,
    padding: 12,
  },
  notificationCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#ddd',
  },
  notificationCardNew: {
    backgroundColor: '#FFF9F0',
    borderLeftColor: '#FF8C42',
    borderWidth: 1,
    borderColor: '#FFD9B5',
  },
  newBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF8C42',
  },
  newDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF8C42',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  iconTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  requestIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  requestTowImage: {
    width: 34,
    height: 28,
    borderRadius: 7,
    marginRight: 10,
  },
  titleContent: {
    flex: 1,
  },
  requestType: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  timestamp: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  cardContent: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#efefef',
  },
  label: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
    flex: 1,
  },
  value: {
    fontSize: 12,
    color: '#333',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  acceptButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  declineButton: {
    flex: 1,
    backgroundColor: '#EF5350',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  declineButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
  },
  bottomPadding: {
    height: 100,
  },
});

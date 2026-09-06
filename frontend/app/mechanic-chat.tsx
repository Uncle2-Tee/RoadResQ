import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TextInput, View } from 'react-native';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { createRequestHistory, updateRequestHistoryStatus } from '../services/api-client';
import { getLocationName } from '../services/location-label';
import { stopMechanicRequestSound } from '../services/notification-sound';
import { recordTowRequest } from '../services/request-history-recorder';
import { touchRequestOverview } from '../services/request-sync';

type UserRole = 'driver' | 'mechanic';
type RequestKind = 'service' | 'tow';
type RequestStatus = 'pending' | 'confirmed' | 'accepted' | 'declined';

const DRIVER_PHONE_KEY = 'driverPhone';
const USER_ID_KEY = 'userId';

interface ServiceRequest {
  id: string;
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

const REQUESTS_STORAGE_KEY = 'serviceRequests';

const createRequestId = () => `REQ-${Date.now()}`;

const hasResolvedLocationName = (locationName: string) => {
  const normalizedName = locationName.trim().toLocaleLowerCase();
  return Boolean(normalizedName) && ![
    'location unavailable',
    'location not provided',
    'location name unavailable',
    'getting location...',
    'finding your exact location...',
  ].includes(normalizedName);
};

const readRequests = async (): Promise<ServiceRequest[]> => {
  const raw = await AsyncStorage.getItem(REQUESTS_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as ServiceRequest[]) : [];
};

const saveRequests = async (requests: ServiceRequest[]) => {
  await AsyncStorage.setItem(REQUESTS_STORAGE_KEY, JSON.stringify(requests));
};

export default function MechanicChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const role: UserRole = params.role === 'mechanic' ? 'mechanic' : 'driver';
  const mechanicId = (params.mechanicId as string) || '';
  const mechanicName = (params.mechanicName as string) || 'Service Provider';
  const mechanicPhone = (params.mechanicPhone as string) || '';
  const driverName = (params.driverName as string) || 'Driver';
  const requestId = (params.requestId as string) || '';
  const requestType: RequestKind = params.requestType === 'tow' ? 'tow' : 'service';
  const towServiceId = (params.serviceId as string) || mechanicId;
  const towServicePrice = Number(params.servicePrice || 0);
  const towServiceEstimatedTime = Number(params.serviceEstimatedTime || 0);
  const suppliedDriverLocation = (params.driverLocation as string) || 'Location unavailable';

  const [problemText, setProblemText] = useState('');
  const [currentRequest, setCurrentRequest] = useState<ServiceRequest | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const lastAlertStatusRef = useRef<RequestStatus | null>(null);

  const title = useMemo(
    () => (role === 'driver' ? mechanicName : 'Request Details'),
    [role, mechanicName]
  );

  const loadRequest = async () => {
    const requests = await readRequests();

    if (requestId) {
      const found = requests.find((item) => item.id === requestId) || null;
      setCurrentRequest(found);
      return;
    }

    if (role === 'mechanic') {
      const pendingForMechanic = requests
        .filter((item) => item.mechanicId === mechanicId && item.status === 'pending')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setCurrentRequest(pendingForMechanic[0] || null);
      return;
    }

    setCurrentRequest(null);
  };

  useEffect(() => {
    loadRequest();
  }, [requestId, role, mechanicId, driverName]);

  useEffect(() => {
    if (role !== 'driver' || !currentRequest) {
      return;
    }

    const timer = setInterval(async () => {
      const requests = await readRequests();
      const updated = requests.find((item) => item.id === currentRequest.id);

      if (!updated) {
        return;
      }

      setCurrentRequest(updated);

      const hasStatusUpdate =
        updated.status !== 'pending' && lastAlertStatusRef.current !== updated.status;

      if (hasStatusUpdate) {
        lastAlertStatusRef.current = updated.status;
        Alert.alert(
          'Request Status',
          updated.status === 'accepted'
            ? 'Accepted: your service request has been accepted.'
            : 'Declined: your service request was declined. Please choose another provider.'
        );
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [role, currentRequest]);

  const handleSendRequest = async () => {
    const problemDescription = problemText.trim();
    if (!problemDescription) {
      Alert.alert('Message required', 'Please describe your problem before sending.');
      return;
    }

    if (!mechanicId) {
      Alert.alert('Error', 'Unable to identify service provider.');
      return;
    }

    setIsSaving(true);
    try {
      let driverLocation = suppliedDriverLocation;
      let driverPhone: string | undefined;
      let driverId: string | null = null;
      
      // Try to get driver's phone number
      try {
        const [savedPhone, savedUserId] = await Promise.all([
          AsyncStorage.getItem(DRIVER_PHONE_KEY),
          AsyncStorage.getItem(USER_ID_KEY),
        ]);
        if (savedPhone) {
          driverPhone = savedPhone;
        }
        driverId = savedUserId;
      } catch (phoneError) {
        console.error('Error getting driver details:', phoneError);
      }
      
      // Reuse the map's resolved address. Only request GPS when this screen was opened directly.
      if (!hasResolvedLocationName(driverLocation)) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const cachedLocation = await Location.getLastKnownPositionAsync({
              maxAge: 2 * 60 * 1000,
              requiredAccuracy: 1000,
            });
            const location =
              cachedLocation ||
              (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
            const { latitude, longitude } = location.coords;
            driverLocation = await getLocationName(latitude, longitude);
          }
        } catch (locationError) {
          console.error('Error getting location:', locationError);
        }
      }
      
      if (requestType === 'tow') {
        const towRequest = await recordTowRequest({
          service: {
            id: towServiceId,
            mechanicId,
            name: mechanicName,
            phone: mechanicPhone,
            price: Number.isFinite(towServicePrice) ? towServicePrice : 0,
            estimatedTime: Number.isFinite(towServiceEstimatedTime)
              ? towServiceEstimatedTime
              : 0,
          },
          driverName,
          driverLocation,
          problemDescription,
        });
        const now = new Date().toISOString();
        setCurrentRequest({
          id: towRequest.id,
          mechanicId,
          mechanicName,
          mechanicPhone,
          driverName,
          driverPhone,
          problemDescription,
          driverLocation,
          status: 'confirmed',
          createdAt: towRequest.timestamp,
          updatedAt: now,
        });
        setProblemText('');
        Alert.alert('Sent', `Your tow request has been sent to the provider.\nRequest ID: ${towRequest.id}`);
        return;
      }

      const requests = await readRequests();
      const requestId = createRequestId();
      const newRequest: ServiceRequest = {
        id: requestId,
        mechanicId,
        mechanicName,
        mechanicPhone,
        driverName,
        driverPhone,
        problemDescription,
        driverLocation,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveRequests([...requests, newRequest]);
      setCurrentRequest(newRequest);
      setProblemText('');
      touchRequestOverview().catch(() => {});

      createRequestHistory({
        requestId,
        type: 'service',
        status: 'pending',
        driverId,
        driverName,
        driverPhone,
        driverLocation,
        mechanicId,
        providerName: mechanicName,
        providerPhone: mechanicPhone,
        problemDescription,
      })
        .then(() => touchRequestOverview())
        .catch((error) => {
          console.warn('Unable to sync mechanic request in the background:', error);
        });

      Alert.alert('Sent', `Your request has been sent to the provider.\nRequest ID: ${requestId}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleMechanicDecision = async (status: RequestStatus) => {
    if (!currentRequest) {
      return;
    }

    setIsSaving(true);
    try {
      stopMechanicRequestSound();
      const requests = await readRequests();
      const updatedRequests = requests.map((item) => {
        if (item.id !== currentRequest.id) {
          return item;
        }

        return {
          ...item,
          status,
          updatedAt: new Date().toISOString(),
        };
      });

      await saveRequests(updatedRequests);
      await touchRequestOverview();
      const updatedCurrent = updatedRequests.find((item) => item.id === currentRequest.id) || null;
      setCurrentRequest(updatedCurrent);

      await updateRequestHistoryStatus({
        requestId: currentRequest.id,
        status,
        acceptedBy: status === 'accepted' ? mechanicName : null,
      });
      await touchRequestOverview();
      Alert.alert('Updated', `Request ${status}.`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ThemedText style={styles.backButtonText}>←</ThemedText>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <ThemedText style={styles.headerTitle}>{title}</ThemedText>
          <ThemedText style={styles.headerSubtitle}>
            {role === 'driver' ? `Provider • ${mechanicPhone}` : 'Mechanic response panel'}
          </ThemedText>
        </View>
      </View>

      <View style={styles.content}>
        {role === 'driver' && !currentRequest && (
          <>
            <ThemedText style={styles.sectionTitle}>Describe your problem</ThemedText>
            <TextInput
              style={styles.input}
              value={problemText}
              onChangeText={setProblemText}
              placeholder="Describe your issue here..."
              placeholderTextColor="#888"
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[styles.primaryButton, isSaving ? styles.disabledButton : null]}
              onPress={handleSendRequest}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText style={styles.primaryButtonText}>Send Request</ThemedText>
              )}
            </TouchableOpacity>
          </>
        )}

        {currentRequest && (
          <View style={styles.requestCard}>
            <ThemedText style={styles.requestTitle}>Problem Report</ThemedText>
            <ThemedText style={styles.requestMeta}>
              Request ID: {currentRequest.id}
            </ThemedText>
            <ThemedText style={styles.requestText}>{currentRequest.problemDescription}</ThemedText>
            <ThemedText style={styles.requestMeta}>
              Driver: {currentRequest.driverName}
            </ThemedText>
            <ThemedText style={styles.requestMeta}>
              Status: {currentRequest.status.toUpperCase()}
            </ThemedText>
          </View>
        )}

        {role === 'driver' && currentRequest?.status === 'pending' && (
          <ThemedText style={styles.waitingText}>
            Waiting for provider response. You will receive an alert once accepted or declined.
          </ThemedText>
        )}

        {role === 'mechanic' && currentRequest?.status === 'pending' && (
          <View style={styles.decisionRow}>
            <TouchableOpacity
              style={[styles.acceptButton, isSaving ? styles.disabledButton : null]}
              onPress={() => handleMechanicDecision('accepted')}
              disabled={isSaving}
            >
              <ThemedText style={styles.decisionText}>Accept</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.declineButton, isSaving ? styles.disabledButton : null]}
              onPress={() => handleMechanicDecision('declined')}
              disabled={isSaving}
            >
              <ThemedText style={styles.decisionText}>Decline</ThemedText>
            </TouchableOpacity>
          </View>
        )}

        {role === 'mechanic' && !currentRequest && (
          <ThemedText style={styles.waitingText}>No pending request for this provider.</ThemedText>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 40,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  backButtonText: {
    fontSize: 24,
    color: '#000',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 10,
  },
  input: {
    minHeight: 130,
    maxHeight: 220,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    fontSize: 14,
    color: '#333',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#FF8C42',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.7,
  },
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#eee',
    marginBottom: 14,
  },
  requestTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  requestText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
    marginBottom: 10,
  },
  requestMeta: {
    fontSize: 12,
    color: '#666',
    marginTop: 3,
  },
  waitingText: {
    fontSize: 13,
    color: '#666',
  },
  decisionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#28a745',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  declineButton: {
    flex: 1,
    backgroundColor: '#dc3545',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  decisionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});

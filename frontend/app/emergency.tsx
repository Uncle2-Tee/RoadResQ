import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { AppIcon } from '../components/app-icon';
import { Drawer } from '../components/drawer';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { getMechanicShops } from '../services/api-client';
import { getCachedDriverLocation, saveDriverLocation } from '../services/driver-location-cache';
import { getLocationName } from '../services/location-label';
import { calculateDistance } from '../services/location-service';
import { recordEmergencyRequest } from '../services/request-history-recorder';

const DRIVER_NAME_KEY = 'driverName';
const EMERGENCY_PHONE = '112';
const MAX_CACHED_LOCATION_ACCURACY_METERS = 250;

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type Provider = {
  id: string;
  mechanicId?: string | null;
  name: string;
  phone: string;
  latitude: number;
  longitude: number;
  distance: number;
  status: 'active' | 'inactive';
};

async function fetchNearbyEmergencyProviders(latitude: number, longitude: number): Promise<Provider[]> {
  const shops = await getMechanicShops({
    forceRefresh: true,
    providerType: 'tow',
    includeInactive: true,
    databaseOnly: true,
  });

  return shops
    .filter((shop) => String(shop.providerType || '').trim().toLowerCase() === 'tow')
    .map<Provider>((shop) => ({
      id: shop.shopId || shop.id,
      mechanicId: shop.mechanicId,
      name: shop.shopName,
      phone: shop.phone,
      latitude: shop.latitude,
      longitude: shop.longitude,
      distance: calculateDistance(latitude, longitude, shop.latitude, shop.longitude),
      status: String(shop.status || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
    }))
    .filter((provider) => provider.status === 'active')
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
}

export default function EmergencyScreen() {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [driverName, setDriverName] = useState('Driver');
  const [region, setRegion] = useState<Region | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationText, setLocationText] = useState('Finding your location...');
  const [details, setDetails] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedProvider = useMemo(() => providers[0] || null, [providers]);

  useEffect(() => {
    AsyncStorage.getItem(DRIVER_NAME_KEY).then((savedName) => {
      if (savedName) setDriverName(savedName);
    });
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (active) {
          setErrorMsg('Location permission denied. Please allow location access for emergency assistance.');
          setLoading(false);
        }
        return;
      }

      try {
        const cached = await Location.getLastKnownPositionAsync({
          maxAge: 5 * 60 * 1000,
          requiredAccuracy: 5000,
        });

        if (cached && active) {
          const coords = cached.coords;
          if (coords.accuracy !== null && coords.accuracy <= MAX_CACHED_LOCATION_ACCURACY_METERS) {
            applyLocation(coords.latitude, coords.longitude);
          }
        }

        const live = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!active) return;
        applyLocation(live.coords.latitude, live.coords.longitude);
        const nearby = await fetchNearbyEmergencyProviders(live.coords.latitude, live.coords.longitude);
        if (active) setProviders(nearby);
      } catch (error) {
        console.error('Unable to get emergency location:', error);
        if (active) {
          const cachedLocation = await getCachedDriverLocation();
          if (cachedLocation) {
            applyLocation(cachedLocation.latitude, cachedLocation.longitude);
            const nearby = await fetchNearbyEmergencyProviders(cachedLocation.latitude, cachedLocation.longitude);
            if (active) setProviders(nearby);
          } else {
            setErrorMsg('Unable to fetch your location. Please try again.');
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const applyLocation = (latitude: number, longitude: number) => {
    const nextRegion = { latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 };
    setDriverLocation({ latitude, longitude });
    setRegion(nextRegion);
    saveDriverLocation(latitude, longitude).catch(() => {});
    const fallbackName = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    setLocationText(fallbackName);

    void (async () => {
      try {
        const place = await getLocationName(latitude, longitude, fallbackName);
        setLocationText(place || fallbackName);
      } catch {
        // Keep the exact GPS coordinates when reverse geocoding is unavailable.
      }
    })();
  };

  const triggerEmergency = async () => {
    if (!driverLocation) {
      Alert.alert('Location unavailable', 'Please wait for your location to load before sending an emergency request.');
      return;
    }

    setSubmitting(true);
    try {
      const provider = selectedProvider;
      const emergencyMessage = details.trim() || 'Emergency assistance requested.';

      if (provider) {
        await recordEmergencyRequest({
          provider: {
            id: provider.id,
            mechanicId: provider.mechanicId,
            name: provider.name,
            phone: provider.phone,
          },
          driverName,
          driverLocation: locationText,
          problemDescription: emergencyMessage,
        });
      }

      Alert.alert(
        'Emergency assistance sent',
        provider
          ? `Your emergency request was sent to ${provider.name}. If they do not respond, we will redirect you to the emergency hotline.`
          : `Your emergency request has been created. We could not find a nearby provider, so please call ${EMERGENCY_PHONE} immediately.`,
        [
          {
            text: 'Call emergency line',
            onPress: () => {
              if (Platform.OS === 'web') {
                window.location.href = `tel:${EMERGENCY_PHONE}`;
              }
            },
          },
          { text: 'OK' },
        ]
      );

      if (!provider) {
        router.back();
      } else {
        router.push({
          pathname: '/mechanic-chat',
          params: {
            role: 'driver',
            driverName,
            mechanicName: provider.name,
            mechanicPhone: provider.phone,
            mechanicId: provider.mechanicId || provider.id,
            requestType: 'emergency',
            serviceId: provider.id,
            servicePrice: '0',
            serviceEstimatedTime: '10',
            driverLocation: locationText,
          },
        });
      }
    } catch (error) {
      console.error('Unable to trigger emergency request:', error);
      Alert.alert('Emergency request failed', 'Please try again or call the emergency line directly.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerContainer}>
        <TouchableOpacity style={styles.menuIcon} onPress={() => setDrawerOpen(true)} accessibilityLabel="Open menu">
          <AppIcon name="menu" size={26} color="#333" />
        </TouchableOpacity>
        <ThemedText type="title" style={styles.title}>Emergency Assistance</ThemedText>
      </View>

      {errorMsg ? (
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>{errorMsg}</ThemedText>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.alertBanner}>
          <AppIcon name="alert" size={20} color="#fff" />
          <ThemedText style={styles.alertText}>Call emergency services if you are in immediate danger.</ThemedText>
        </View>

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Current location</ThemedText>
          <View style={styles.locationRow}>
            <AppIcon name="mapPin" size={18} color="#2563EB" />
            <ThemedText style={styles.locationText}>{locationText}</ThemedText>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Additional details</ThemedText>
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Add anything that will help the provider find or assist you"
            multiline
            style={styles.textInput}
            placeholderTextColor="#9CA3AF"
          />
        </View>

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Nearest available provider</ThemedText>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#FF8C42" />
              <ThemedText style={styles.loadingText}>Finding nearby providers…</ThemedText>
            </View>
          ) : selectedProvider ? (
            <View style={styles.providerCard}>
              <View style={styles.providerTextBlock}>
                <ThemedText style={styles.providerName}>{selectedProvider.name}</ThemedText>
                <ThemedText style={styles.providerMeta}>{selectedProvider.distance.toFixed(1)} km away</ThemedText>
                <ThemedText style={styles.providerMeta}>{selectedProvider.phone}</ThemedText>
              </View>
              <TouchableOpacity
                onPress={() => {
                  Linking.openURL(`tel:${selectedProvider.phone.replace(/[^\d+]/g, '')}`).catch((error) => {
                    console.error('Unable to open emergency provider dialer:', error);
                  });
                }}
                style={styles.callButton}
                accessibilityRole="button"
                accessibilityLabel={`Call ${selectedProvider.name}`}
              >
                <AppIcon name="phone" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <ThemedText style={styles.emptyText}>No nearby providers were found. Please call the emergency hotline immediately.</ThemedText>
          )}
        </View>

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={triggerEmergency}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator size="small" color="#fff" /> : <ThemedText style={styles.submitText}>Send emergency request</ThemedText>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.hotlineButton} onPress={() => {}}>
          <ThemedText style={styles.hotlineText}>Emergency hotline: {EMERGENCY_PHONE}</ThemedText>
        </TouchableOpacity>
      </ScrollView>

      <Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} driverName={driverName} role="driver" />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  menuIcon: {
    marginRight: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  alertBanner: {
    backgroundColor: '#DC2626',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
    marginBottom: 16,
  },
  alertText: {
    color: '#fff',
    fontWeight: '600',
    flex: 1,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  locationText: {
    flex: 1,
    color: '#374151',
    lineHeight: 20,
  },
  textInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    padding: 12,
    textAlignVertical: 'top',
    color: '#111827',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#4B5563',
  },
  emptyText: {
    color: '#6B7280',
    lineHeight: 20,
  },
  providerCard: {
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  providerTextBlock: {
    flex: 1,
  },
  providerName: {
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  providerMeta: {
    color: '#4B5563',
    fontSize: 12,
    marginBottom: 2,
  },
  callButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButton: {
    backgroundColor: '#DC2626',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  hotlineButton: {
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  hotlineText: {
    color: '#fff',
    fontWeight: '600',
  },
  errorContainer: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: {
    color: '#B91C1C',
    fontWeight: '600',
  },
});

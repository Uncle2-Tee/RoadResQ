import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppIcon } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { Drawer } from '../components/drawer';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import MapView, { Marker, type NativeMapView } from '../components/native-map';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { useResponsive } from '../hooks/use-responsive';
import { getLocationName } from '../services/location-label';

const MECHANIC_NAME_KEY = 'mechanicName';

// Ghana boundaries
const GHANA_BOUNDS = {
  north: 11.17,
  south: 1.04,
  east: 1.20,
  west: -3.23,
};

const isLocationInGhana = (latitude: number, longitude: number): boolean => {
  return (
    latitude >= GHANA_BOUNDS.south &&
    latitude <= GHANA_BOUNDS.north &&
    longitude >= GHANA_BOUNDS.west &&
    longitude <= GHANA_BOUNDS.east
  );
};

interface MechanicShop {
  id: string;
  name: string;
  type: 'registered' | 'unregistered';
  rating: number;
  reviews: number;
  latitude: number;
  longitude: number;
  distance: number;
  phone: string;
  specialties: string[];
  isOpen: boolean;
}

const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Generate Ghana-specific mechanic shops near a location
const generateNearbyMechanics = (latitude: number, longitude: number): MechanicShop[] => {
  const shops: MechanicShop[] = [
    {
      id: 'mech-gh-1',
      name: 'Accra Auto Repair Pro',
      type: 'registered',
      rating: 4.8,
      reviews: 156,
      latitude: latitude + (Math.random() - 0.5) * 0.015,
      longitude: longitude + (Math.random() - 0.5) * 0.015,
      distance: 0,
      phone: '+233 55 111 2001',
      specialties: ['Engine Repair', 'Brake Service', 'Transmission'],
      isOpen: true,
    },
    {
      id: 'mech-gh-2',
      name: 'Ghana Motor Solutions',
      type: 'registered',
      rating: 4.6,
      reviews: 124,
      latitude: latitude + (Math.random() - 0.5) * 0.015,
      longitude: longitude + (Math.random() - 0.5) * 0.015,
      distance: 0,
      phone: '+233 55 222 3002',
      specialties: ['Oil Change', 'Tire Service', 'Battery Replacement'],
      isOpen: true,
    },
    {
      id: 'mech-gh-3',
      name: 'Premier Auto Mechanics',
      type: 'registered',
      rating: 4.9,
      reviews: 203,
      latitude: latitude + (Math.random() - 0.5) * 0.015,
      longitude: longitude + (Math.random() - 0.5) * 0.015,
      distance: 0,
      phone: '+233 55 333 4003',
      specialties: ['Complete Overhaul', 'Diagnostic', 'Custom Work'],
      isOpen: true,
    },
    {
      id: 'mech-gh-4',
      name: 'Roadside Quick Fix',
      type: 'unregistered',
      rating: 4.3,
      reviews: 89,
      latitude: latitude + (Math.random() - 0.5) * 0.015,
      longitude: longitude + (Math.random() - 0.5) * 0.015,
      distance: 0,
      phone: '+233 55 444 5004',
      specialties: ['Quick Repairs', 'Emergency Service'],
      isOpen: true,
    },
    {
      id: 'mech-gh-5',
      name: 'Kumasi Automotive Services',
      type: 'unregistered',
      rating: 4.4,
      reviews: 67,
      latitude: latitude + (Math.random() - 0.5) * 0.015,
      longitude: longitude + (Math.random() - 0.5) * 0.015,
      distance: 0,
      phone: '+233 55 555 6005',
      specialties: ['Bodywork', 'Welding', 'Frame Repair'],
      isOpen: true,
    },
    {
      id: 'mech-gh-6',
      name: 'Express Auto Care',
      type: 'registered',
      rating: 4.7,
      reviews: 145,
      latitude: latitude + (Math.random() - 0.5) * 0.015,
      longitude: longitude + (Math.random() - 0.5) * 0.015,
      distance: 0,
      phone: '+233 55 666 7006',
      specialties: ['General Maintenance', 'Alignment', 'Electrical'],
      isOpen: true,
    },
  ];

  // Calculate actual distances
  return shops.map(shop => ({
    ...shop,
    distance: Math.round(calculateDistance(latitude, longitude, shop.latitude, shop.longitude) * 10) / 10,
  })).sort((a, b) => a.distance - b.distance);
};

export default function MechanicRequestScreen() {
  const router = useRouter();
  const mapRef = useRef<NativeMapView>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const dimensions = useWindowDimensions();
  const responsive = useResponsive();
  
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [mechanicShops, setMechanicShops] = useState<MechanicShop[]>([]);
  const [mechanicName, setMechanicName] = useState('Mechanic');
  const [selectedShop, setSelectedShop] = useState<MechanicShop | null>(null);
  const [mechanicLocationAddress, setMechanicLocationAddress] = useState<string>('Getting location...');

  useEffect(() => {
    loadData();
  }, []);

  const applyLocationData = async (latitude: number, longitude: number) => {
    if (!isLocationInGhana(latitude, longitude)) {
      Alert.alert(
        'Service Not Available',
        'This service is currently only available in Ghana. Your current location is outside Ghana.',
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
      return false;
    }

    setCurrentLocation({ lat: latitude, lon: longitude });
    const locationName = await getLocationName(latitude, longitude);
    setMechanicLocationAddress(locationName);
    setLoading(false);

    const shops = generateNearbyMechanics(latitude, longitude);
    setMechanicShops(shops);

    if (shops.length > 0) {
      setSelectedShop((current) => shops.find((shop) => shop.id === current?.id) || shops[0]);
    }

    setTimeout(() => {
      if (mapRef.current && shops.length > 0) {
        mapRef.current.fitToCoordinates(
          [
            { latitude, longitude },
            ...shops.map(s => ({ latitude: s.latitude, longitude: s.longitude }))
          ],
          {
            edgePadding: { top: 100, right: 100, bottom: 100, left: 100 },
            animated: true,
          }
        );
      }
    }, 300);

    return true;
  };

  const loadData = async () => {
    try {
      setLoading(!currentLocation);

      // Get mechanic name
      const savedName = await AsyncStorage.getItem(MECHANIC_NAME_KEY);
      if (savedName) {
        setMechanicName(savedName);
      }

      // Get location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Error', 'Location permission is required to find nearby mechanics');
        setLoading(false);
        return;
      }
      setLoading(false);

      const cachedLocation = await Location.getLastKnownPositionAsync({
        maxAge: 5 * 60 * 1000,
        requiredAccuracy: 5000,
      }).catch(() => null);
      let hasUsableLocation = false;

      if (cachedLocation) {
        const { latitude, longitude } = cachedLocation.coords;
        hasUsableLocation = await applyLocationData(latitude, longitude);
      }

      const liveLocation = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 6000);
        }),
      ]);

      if (liveLocation) {
        const { latitude, longitude } = liveLocation.coords;
        await applyLocationData(latitude, longitude);
      } else if (!hasUsableLocation) {
        Alert.alert('Error', 'Location is taking longer than expected. Please try again.');
      }
    } catch (error) {
      console.error('Error loading mechanic shops:', error);
      Alert.alert('Error', 'Unable to load nearby mechanics. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectShop = (shop: MechanicShop) => {
    setSelectedShop(shop);
    
    // Animate map to selected shop
    if (mapRef.current && currentLocation) {
      mapRef.current.animateToRegion(
        {
          latitude: shop.latitude,
          longitude: shop.longitude,
          latitudeDelta: 0.015,
          longitudeDelta: 0.015,
        },
        500
      );
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <AppIcon name="chevronLeft" size={24} color="#000" />
          </TouchableOpacity>
          <ThemedText type="title" style={styles.title}>Nearby Mechanics</ThemedText>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF8C42" />
          <ThemedText style={styles.loadingText}>Finding nearby mechanics in Ghana...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <AppIcon name="chevronLeft" size={24} color="#000" />
        </TouchableOpacity>
        <ThemedText type="title" style={styles.title}>Nearby Mechanics</ThemedText>
      </View>

      {/* Map Section */}
      {currentLocation && (
        <View style={[
          styles.mapContainer,
          {
            height: responsive.isPortrait 
              ? Math.min(300 * responsive.scale, dimensions.height * 0.35)
              : Math.min(200 * responsive.scale, dimensions.height * 0.4),
          }
        ]}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{
              latitude: currentLocation.lat,
              longitude: currentLocation.lon,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
          >
            {/* Mechanic Location */}
            <Marker
              coordinate={{
                latitude: currentLocation.lat,
                longitude: currentLocation.lon,
              }}
              title="Your Location"
              description={mechanicLocationAddress}
            >
              <View style={styles.mechanicMarker}>
                <AppIcon name="wrench" size={20} color="#fff" />
              </View>
            </Marker>

            {/* Mechanic Shops */}
            {mechanicShops.map((shop) => (
              <Marker
                key={shop.id}
                coordinate={{
                  latitude: shop.latitude,
                  longitude: shop.longitude,
                }}
                title={shop.name}
                description={`${shop.distance} km away • ${shop.type}`}
                onPress={() => handleSelectShop(shop)}
              >
                <View 
                  style={[
                    styles.shopMarker,
                    shop.type === 'registered' ? styles.shopMarkerRegistered : styles.shopMarkerUnregistered,
                    selectedShop?.id === shop.id && styles.shopMarkerSelected,
                  ]}
                >
                  <AppIcon name="store" size={18} color="#fff" />
                </View>
              </Marker>
            ))}
          </MapView>

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendMarker, styles.shopMarkerRegistered]} />
              <ThemedText style={styles.legendText}>Registered</ThemedText>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendMarker, styles.shopMarkerUnregistered]} />
              <ThemedText style={styles.legendText}>Unregistered</ThemedText>
            </View>
          </View>
        </View>
      )}

      <ScrollView 
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Location Info */}
        <View style={styles.locationCard}>
          <AppIcon name="wrench" size={28} color="#FF8C42" style={styles.locationIcon} />
          <View style={styles.locationInfo}>
            <ThemedText style={styles.locationTitle}>Your Location</ThemedText>
            <ThemedText style={styles.locationCoords}>
              {mechanicLocationAddress}
            </ThemedText>
          </View>
          <TouchableOpacity onPress={loadData}>
            <AppIcon name="refresh" size={18} color="#FF8C42" />
          </TouchableOpacity>
        </View>

        {/* Nearby Mechanics */}
        <ThemedText style={styles.sectionTitle}>
          Nearby Mechanics ({mechanicShops.length})
        </ThemedText>

        {mechanicShops.length > 0 ? (
          mechanicShops.map((shop) => (
            <TouchableOpacity
              key={shop.id}
              style={[
                styles.shopCard,
                selectedShop?.id === shop.id && styles.shopCardSelected,
              ]}
              onPress={() => handleSelectShop(shop)}
            >
              <View style={styles.shopHeader}>
                <View style={styles.shopInfo}>
                  <View style={styles.shopNameContainer}>
                    <ThemedText style={styles.shopName}>{shop.name}</ThemedText>
                    <View style={[styles.typeBadge, shop.type === 'registered' ? styles.registeredBadge : styles.unregisteredBadge]}>
                      <ThemedText style={styles.typeBadgeText}>
                        {shop.type === 'registered' ? 'Registered' : 'Unregistered'}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={styles.ratingContainer}>
                    <View style={styles.ratingValue}><AppIcon name="star" size={13} color="#FF8C42" /><ThemedText style={styles.rating}>{shop.rating}</ThemedText></View>
                    <ThemedText style={styles.reviews}>({shop.reviews} reviews)</ThemedText>
                  </View>
                </View>
                <View style={styles.statusBadge}>
                  <ThemedText style={styles.statusText}>{shop.isOpen ? 'Open' : 'Closed'}</ThemedText>
                </View>
              </View>

              <View style={styles.shopDetails}>
                <View style={styles.detailItem}>
                  <AppIcon name="ruler" size={14} color="#666" style={styles.detailIcon} />
                  <ThemedText style={styles.detailText}>{shop.distance} km away</ThemedText>
                </View>
                <View style={styles.detailItem}>
                  <AppIcon name="phone" size={14} color="#666" style={styles.detailIcon} />
                  <ThemedText style={styles.detailText}>{shop.phone}</ThemedText>
                </View>
              </View>

              {/* Specialties */}
              <View style={styles.specialtiesContainer}>
                {shop.specialties.map((specialty, idx) => (
                  <View key={idx} style={styles.specialtyTag}>
                    <ThemedText style={styles.specialtyText}>{specialty}</ThemedText>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyState}>
            <AppIcon name="wrench" size={64} color="#999" style={styles.emptyIcon} />
            <ThemedText style={styles.emptyText}>No mechanics nearby</ThemedText>
            <TouchableOpacity 
              style={styles.retryButton}
              onPress={loadData}
            >
              <ThemedText style={styles.retryButtonText}>Try Again</ThemedText>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <BottomNav />
      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        driverName={mechanicName}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
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
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    flex: 1,
  },
  mapContainer: {
    height: 300,
    position: 'relative',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  map: {
    flex: 1,
    width: '100%',
  },
  mechanicMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#9C27B0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  mechanicMarkerText: {
    fontSize: 20,
  },
  shopMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  shopMarkerRegistered: {
    backgroundColor: '#27AE60',
  },
  shopMarkerUnregistered: {
    backgroundColor: '#FF9800',
  },
  shopMarkerSelected: {
    borderWidth: 3,
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  shopMarkerText: {
    fontSize: 18,
  },
  legend: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    flexDirection: 'row',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendMarker: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fff',
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  locationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  locationIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  locationInfo: {
    flex: 1,
  },
  locationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  locationCoords: {
    fontSize: 12,
    color: '#666',
  },
  refreshIcon: {
    fontSize: 18,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  shopCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  shopCardSelected: {
    borderColor: '#FF8C42',
    backgroundColor: '#fffbf7',
  },
  shopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  shopInfo: {
    flex: 1,
  },
  shopNameContainer: {
    marginBottom: 6,
  },
  shopName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  registeredBadge: {
    backgroundColor: '#E8F5E9',
  },
  unregisteredBadge: {
    backgroundColor: '#FFF3E0',
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rating: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF8C42',
  },
  reviews: {
    fontSize: 12,
    color: '#999',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  shopDetails: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  detailItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailIcon: {
    fontSize: 14,
  },
  detailText: {
    fontSize: 11,
    color: '#666',
    flex: 1,
  },
  specialtiesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  specialtyTag: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  specialtyText: {
    fontSize: 10,
    color: '#666',
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    fontWeight: '500',
  },
  retryButton: {
    backgroundColor: '#FF8C42',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});


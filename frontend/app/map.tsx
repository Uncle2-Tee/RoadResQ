import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Platform, StyleSheet, View } from 'react-native';

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { AppIcon } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { Drawer } from '../components/drawer';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { SmsMessageModal } from '../components/sms-message-modal';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';

// NOTE: This screen uses react-native-maps and expo-location.
// Install dependencies:
//   expo install react-native-maps expo-location
// or
//   yarn add react-native-maps expo-location
// Then rebuild the app if using a native build (expo run:android / expo run:ios).

import * as Location from 'expo-location';
import MapView, { Marker, type NativeMapView } from '../components/native-map';
import { saveDriverLocation } from '../services/driver-location-cache';
import { fetchNearbyShops, ShopLocation } from '../services/location-service';
import { getLocationName } from '../services/location-label';
import { recordMechanicContactRequest } from '../services/request-history-recorder';

interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

type Mechanic = ShopLocation;
const SHOP_STATUS_REFRESH_MS = 10000;
const MAX_CACHED_LOCATION_ACCURACY_METERS = 250;

// Function to update nearby mechanics based on driver location
const updateNearbyMechanics = async (
  latitude: number,
  longitude: number,
  setNearbyMechanics: (mechanics: Mechanic[]) => void,
  options: { forceRefresh?: boolean } = {}
) => {
  try {
    const shops = await fetchNearbyShops(
      latitude,
      longitude,
      Number.POSITIVE_INFINITY,
      options
    );
    setNearbyMechanics(shops);
  } catch (error) {
    console.error('Error updating nearby mechanics:', error);
  }
};

export default function MapScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const mapRef = useRef<NativeMapView>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [nearbyMechanics, setNearbyMechanics] = useState<Mechanic[]>([]);
  const [filteredMechanics, setFilteredMechanics] = useState<Mechanic[]>([]);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [driverLocationName, setDriverLocationName] = useState('Finding your exact location...');
  const [loading, setLoading] = useState(true);
  const [isTracking, setIsTracking] = useState(false);
  const [smsMechanic, setSmsMechanic] = useState<Mechanic | null>(null);
  const [smsSending, setSmsSending] = useState(false);
  const driverName = (params.driverName as string) || 'Driver';
  const locationWatcherRef = useRef<any>(null);

  // Set loading timeout - if data doesn't load within 2 seconds, show partial UI
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 2000);
    
    return () => clearTimeout(timer);
  }, []);

  // Keep all mechanics and sort by actual distance from the user's current location
  const filterMechanics = (mechanics: Mechanic[]) => {
    return [...mechanics].sort((a, b) => (a.distance || 0) - (b.distance || 0));
  };

  // Update filtered mechanics when mechanics change
  useEffect(() => {
    const filtered = filterMechanics(nearbyMechanics);
    setFilteredMechanics(filtered);
  }, [nearbyMechanics]);

  useEffect(() => {
    if (!driverLocation) {
      return;
    }

    let isActive = true;
    getLocationName(driverLocation.latitude, driverLocation.longitude).then((locationName) => {
      if (isActive) {
        setDriverLocationName(locationName);
      }
    });

    return () => {
      isActive = false;
    };
  }, [driverLocation]);

  // Show the nearest shops only and separate registered vs unregistered for rendering
  const VISIBLE_SHOPS = 3;
  const displayedMechanics = filteredMechanics.slice(0, VISIBLE_SHOPS);
  const registeredMechanics = displayedMechanics.filter((m) => m.providerType === 'registered');
  const unregisteredMechanics = displayedMechanics.filter((m) => m.providerType !== 'registered');

  // Initialize real-time location tracking
  useEffect(() => {
    let isActive = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Location permission denied. Please enable location permissions.');
        setLoading(false);
        return;
      }
      setLoading(false);

      try {
        const applyMapLocation = (latitude: number, longitude: number) => {
          if (!isActive) {
            return;
          }

          setDriverLocation({ latitude, longitude });
          saveDriverLocation(latitude, longitude).catch(() => {});
          setRegion({
            latitude,
            longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
          setLoading(false);
        };

        const cachedLocation = await Location.getLastKnownPositionAsync({
          maxAge: 5 * 60 * 1000,
          requiredAccuracy: 5000,
        }).catch(() => null);
        let hasUsableLocation = false;

        if (cachedLocation && cachedLocation.coords.accuracy !== null && cachedLocation.coords.accuracy <= MAX_CACHED_LOCATION_ACCURACY_METERS) {
          const { latitude, longitude } = cachedLocation.coords;
          hasUsableLocation = true;
          applyMapLocation(latitude, longitude);
          updateNearbyMechanics(latitude, longitude, setNearbyMechanics).catch(() => {});
        }

        const liveLocation = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          }),
          new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), 6000);
          }),
        ]);

        if (!isActive) {
          return;
        }

        if (liveLocation) {
          const latitude = liveLocation.coords.latitude;
          const longitude = liveLocation.coords.longitude;
          hasUsableLocation = true;
          applyMapLocation(latitude, longitude);

          // Load cached shops first, then refresh from backend without blocking the map.
          updateNearbyMechanics(latitude, longitude, setNearbyMechanics).catch(() => {});
          updateNearbyMechanics(latitude, longitude, setNearbyMechanics, { forceRefresh: true }).catch(() => {});
        } else if (!hasUsableLocation) {
          setErrorMsg('Location services are taking longer than expected. Please try refreshing.');
          setLoading(false);
          return;
        }

        const trackingSeed = liveLocation || (
          cachedLocation &&
          cachedLocation.coords.accuracy !== null &&
          cachedLocation.coords.accuracy <= MAX_CACHED_LOCATION_ACCURACY_METERS
            ? cachedLocation
            : null
        );
        if (!trackingSeed) {
          return;
        }

        const latitude = trackingSeed.coords.latitude;
        const longitude = trackingSeed.coords.longitude;

        setDriverLocation({ latitude, longitude });
        setRegion({
          latitude,
          longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });

        // Track the driver's position closely while this screen is open.
        locationWatcherRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 3000,
            distanceInterval: 5,
          },
          async (location) => {
            const { latitude: newLat, longitude: newLon } = location.coords;

            setDriverLocation({ latitude: newLat, longitude: newLon });
            saveDriverLocation(newLat, newLon).catch(() => {});

            setRegion({
              latitude: newLat,
              longitude: newLon,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            });
            mapRef.current?.animateToRegion({
              latitude: newLat,
              longitude: newLon,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }, 300);

            await updateNearbyMechanics(newLat, newLon, setNearbyMechanics);
          }
        );
      } catch (error) {
        console.error('Error getting location:', error);
        setErrorMsg('Unable to fetch location');
        setLoading(false);
      }
    })();

    // Cleanup: stop location watcher on unmount
    return () => {
      isActive = false;
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
      }
    };
  }, []);

  // Refresh mechanics when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      let isRefreshing = false;

      const refreshShopStatus = async () => {
        if (!driverLocation || !isActive || isRefreshing) {
          return;
        }

        isRefreshing = true;
        try {
          await updateNearbyMechanics(
            driverLocation.latitude,
            driverLocation.longitude,
            setNearbyMechanics,
            { forceRefresh: true }
          );
        } finally {
          isRefreshing = false;
        }
      };

      refreshShopStatus();
      const statusRefreshTimer = setInterval(refreshShopStatus, SHOP_STATUS_REFRESH_MS);

      return () => {
        isActive = false;
        clearInterval(statusRefreshTimer);
      };
    }, [driverLocation])
  );

  const getDriverLocationLabel = async () => {
    if (!driverLocation) {
      return 'Location not provided';
    }

    return getLocationName(driverLocation.latitude, driverLocation.longitude);
  };

  const getMechanicLocationLabel = (mechanic: Mechanic) =>
    mechanic.location || mechanic.city || mechanic.region || 'Location not provided';

  const handleChat = async (mechanic: Mechanic) => {
    router.push({
      pathname: '/mechanic-chat',
      params: {
        role: 'driver',
        driverName,
        mechanicName: mechanic.name,
        mechanicPhone: mechanic.phone,
        mechanicId: mechanic.mechanicId || mechanic.id,
        requestType: 'service',
        driverLocation: driverLocationName,
      },
    });
  };

  const handleSMS = (mechanic: Mechanic) => {
    setSmsMechanic(mechanic);
  };

  const sendSMS = async (message: string) => {
    if (!smsMechanic || smsSending) {
      return;
    }

    const mechanic = smsMechanic;
    setSmsSending(true);

    try {
      const requestLocationName = await getDriverLocationLabel();
      await recordMechanicContactRequest({
        type: 'sms',
        provider: {
          id: mechanic.id,
          mechanicId: mechanic.mechanicId,
          name: mechanic.name,
          phone: mechanic.phone,
          location: getMechanicLocationLabel(mechanic),
        },
        driverName,
        driverLocation: requestLocationName,
        problemDescription: message,
      });

      setSmsMechanic(null);
      const bodySeparator = Platform.OS === 'ios' ? '&' : '?';
      await Linking.openURL(
        `sms:${mechanic.phone}${bodySeparator}body=${encodeURIComponent(message)}`
      );
    } catch (error) {
      console.error('Unable to send SMS request:', error);
    } finally {
      setSmsSending(false);
    }
  };

  const handleCall = async (mechanic: Mechanic) => {
    const callUrl = `tel:${mechanic.phone}`;
    Linking.openURL(callUrl).catch(() => {
      console.error('Unable to open phone dialer');
    });
  };

  const updateMapPosition = (latitude: number, longitude: number) => {
    const nextRegion = {
      latitude,
      longitude,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };

    setDriverLocation({ latitude, longitude });
    setRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 250);
  };

  const handleRefreshMap = async () => {
    try {
      const lastKnownLocation = await Location.getLastKnownPositionAsync({
        maxAge: 30000,
        requiredAccuracy: 200,
      });

      if (lastKnownLocation && lastKnownLocation.coords.accuracy !== null && lastKnownLocation.coords.accuracy <= MAX_CACHED_LOCATION_ACCURACY_METERS) {
        const { latitude, longitude } = lastKnownLocation.coords;
        updateMapPosition(latitude, longitude);
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = location.coords;
      updateMapPosition(latitude, longitude);
      updateNearbyMechanics(latitude, longitude, setNearbyMechanics, { forceRefresh: true }).catch((error) => {
        console.error('Error refreshing nearby mechanics:', error);
      });
    } catch (error) {
      console.error('Error refreshing location:', error);
    }
  };

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <TouchableOpacity 
          style={styles.menuIcon} 
          onPress={() => setDrawerOpen(true)}
        >
          <AppIcon name="menu" size={26} color="#333" />
        </TouchableOpacity>
        <ThemedText type="title" style={styles.title}>Nearby Mechanics</ThemedText>
      </View>

      {errorMsg ? (
        <ThemedText style={styles.errorText}>{errorMsg}</ThemedText>
      ) : loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF8C42" />
          <ThemedText style={styles.loadingText}>Loading map…</ThemedText>
        </View>
      ) : (
        <>
          {/* Map Container */}
          <View style={styles.mapContainer}>
            {/* Refresh Button */}
            <TouchableOpacity 
              style={styles.refreshButton}
              onPress={handleRefreshMap}
            >
              <AppIcon name="refresh" size={22} color="#FF8C42" />
            </TouchableOpacity>
            {region && driverLocation && (
              <MapView 
                style={styles.map} 
                initialRegion={region} 
                region={region} 
                ref={mapRef}
                showsUserLocation={false}
                showsMyLocationButton={false}
                loadingEnabled={true}
                loadingIndicatorColor="#FF8C42"
                moveOnMarkerPress={false}
              >
                <Marker
                  coordinate={driverLocation}
                  title="Your Location"
                  description={driverLocationName}
                  anchor={{ x: 0.5, y: 1 }}
                  zIndex={1000}
                  tracksViewChanges={false}
                >
                  <View style={styles.driverMarker}>
                    <AppIcon name="mapPin" size={46} color="#2563EB" strokeWidth={3.2} />
                  </View>
                </Marker>

                {/* Registered mechanics */}
                {registeredMechanics.map((mechanic) => (
                  <Marker
                    key={`reg-${mechanic.id}`}
                    coordinate={{ latitude: mechanic.latitude, longitude: mechanic.longitude }}
                    title={mechanic.name}
                    description={`${(mechanic.distance || 0).toFixed(1)} km`}
                    pinColor="#FF8C42"
                    tracksViewChanges={false}
                  />
                ))}

                {/* Unregistered mechanics - keep original marker style */}
                {unregisteredMechanics.map((mechanic) => (
                  <Marker
                    key={`unreg-${mechanic.id}`}
                    coordinate={{ latitude: mechanic.latitude, longitude: mechanic.longitude }}
                    title={mechanic.name}
                    description={`${(mechanic.distance || 0).toFixed(1)} km`}
                    pinColor="#FF8C42"
                    tracksViewChanges={false}
                  />
                ))}
              </MapView>
            )}
            {driverLocation && (
              <View style={styles.locationBanner} pointerEvents="none">
                <AppIcon name="mapPin" size={18} color="#2563EB" />
                <ThemedText style={styles.locationBannerText} numberOfLines={2}>
                  {driverLocationName}
                </ThemedText>
              </View>
            )}
          </View>

          {/* Shop List */}
          <FlatList
            style={styles.listContainer}
            showsVerticalScrollIndicator={false}
            data={filteredMechanics}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <View>
                <View style={styles.shopItem}>
                  <View style={styles.shopInfo}>
                    <ThemedText style={styles.shopName}>{item.name}</ThemedText>
                    <ThemedText style={styles.shopDistance}>
                      {(item.distance || 0).toFixed(1)} km away
                    </ThemedText>
                  </View>

                  <View style={styles.shopActions}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleChat(item)}
                    >
                      <AppIcon name="message" size={18} color="#FF8C42" style={styles.actionIcon} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleCall(item)}
                    >
                      <AppIcon name="phone" size={18} color="#FF8C42" style={styles.actionIcon} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleSMS(item)}
                    >
                      <AppIcon name="smartphone" size={18} color="#FF8C42" style={styles.actionIcon} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.availableBadge}>
                    <ThemedText style={styles.availableText}>Available</ThemedText>
                  </View>
                </View>

                {/* Divider */}
                {index < filteredMechanics.length - 1 && (
                  <View style={styles.divider} />
                )}
              </View>
            )}
            ListHeaderComponent={
              filteredMechanics.length > 0 ? (
                <View style={styles.shopsListWrapper} />
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <ThemedText style={styles.emptyStateText}>No mechanic shops available</ThemedText>
              </View>
            }
            scrollEventThrottle={16}
            removeClippedSubviews={true}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
            contentContainerStyle={styles.listContentContainer}
          />
        </>
      )}

      <BottomNav />
      <Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} driverName={driverName} role="driver" />
      <SmsMessageModal
        visible={Boolean(smsMechanic)}
        recipientName={smsMechanic?.name || ''}
        sending={smsSending}
        onCancel={() => setSmsMechanic(null)}
        onSend={sendSMS}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontWeight: 'bold',
    color: '#000',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  mapContainer: {
    height: 280,
    borderRadius: 12,
    overflow: 'hidden',
    margin: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#e8e8e8',
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  refreshButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 5,
    zIndex: 10,
  },
  refreshIcon: {
    fontSize: 22,
  },
  driverMarker: {
    width: 52,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 4,
    elevation: 7,
  },
  locationBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D9E3F0',
    elevation: 4,
    zIndex: 9,
  },
  locationBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#1F2937',
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
  errorText: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 16,
    color: '#d32f2f',
    paddingHorizontal: 16,
  },
  listContainer: {
    flex: 1,
    paddingHorizontal: 0,
    paddingBottom: 220,
  },
  listContentContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shopsListWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shopItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  shopInfo: {
    flex: 1,
  },
  shopName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  shopDistance: {
    fontSize: 13,
    color: '#666',
  },
  shopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    marginHorizontal: 4,
  },
  actionIcon: {
    fontSize: 18,
  },
  availableBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff9e6',
    borderRadius: 6,
  },
  availableText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF8C42',
  },
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 0,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 16,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
});



import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, ScrollView, StyleSheet, TextInput, View, PanResponder, Modal } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { AppIcon } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { Drawer } from '../components/drawer';
import { Pressable } from '../components/haptic-pressable';
import { SmsMessageModal } from '../components/sms-message-modal';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { LocationPin } from '../components/location-pin';

import * as Location from 'expo-location';
import MapView, { Marker, type NativeMapView } from '../components/native-map';
import { saveDriverLocation } from '../services/driver-location-cache';
import { calculateDistance, fetchNearbyShops, removeDeletedShops, removeUnavailableShopNames, resetLegacyShopData, ShopLocation } from '../services/location-service';
import { getLocationName } from '../services/location-label';
import { recordMechanicContactRequest } from '../services/request-history-recorder';

const PROFILE_PHOTO_URI_KEY = 'driverProfilePhotoUri';
const DRIVER_NAME_KEY = 'driverName';
const CACHED_NEARBY_SHOPS_KEY = 'cachedNearbyShops';
const CACHED_SHOPS_TIMESTAMP_KEY = 'cachedShopsTimestamp';
const SHOP_STATUS_REFRESH_MS = 10000;
const MAX_CACHED_LOCATION_ACCURACY_METERS = 250;
const mechanicShopImage = require('../assets/images/shit.png');
const IS_IOS = Platform.OS === 'ios';

interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

// Type alias for shop location
type Mechanic = ShopLocation;

// Helper function to format time ago
const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
};

// Function to update nearby mechanics based on driver location
// Fetches all registered and sample shops so the dashboard can show shop locations
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
    const availableShops = removeUnavailableShopNames(shops);
    setNearbyMechanics(availableShops);
    
    // Cache the shops data with timestamp
    try {
      await AsyncStorage.multiSet([
        [CACHED_NEARBY_SHOPS_KEY, JSON.stringify(availableShops)],
        [CACHED_SHOPS_TIMESTAMP_KEY, Date.now().toString()],
      ]);
    } catch (cacheError) {
      console.error('Error caching shops:', cacheError);
    }
  } catch (error) {
    console.error('Error updating nearby mechanics:', error);
  }
};

export default function DashboardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const mapRef = useRef<NativeMapView>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [offlineSearchModalOpen, setOfflineSearchModalOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [offlineSearchData, setOfflineSearchData] = useState<Mechanic[]>([]);
  const [offlineSearchTimestamp, setOfflineSearchTimestamp] = useState<number | null>(null);
  const [offlineDataAvailable, setOfflineDataAvailable] = useState(false);
  const [driverName, setDriverName] = useState('John Doe');
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  
  // Map and mechanic search state
  const [region, setRegion] = useState<Region | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nearbyMechanics, setNearbyMechanics] = useState<Mechanic[]>([]);
  const [filteredMechanics, setFilteredMechanics] = useState<Mechanic[]>([]);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [driverLocationName, setDriverLocationName] = useState('Finding your exact location...');
  const [driverMarkerTracksViewChanges, setDriverMarkerTracksViewChanges] = useState(Platform.OS === 'android');
  const [loading, setLoading] = useState(true);
  const [isRefreshingMap, setIsRefreshingMap] = useState(false);
  const locationWatcherRef = useRef<any>(null);
  const lastResolvedLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(true);
  const [smsMechanic, setSmsMechanic] = useState<Mechanic | null>(null);
  const [smsSending, setSmsSending] = useState(false);

  const registerActivity = useCallback(() => {
    // Keep the bottom navigation static while preserving existing touch handlers.
  }, []);

  // Sort nearby mechanics by distance while keeping all registered shops visible
  const filterMechanics = useCallback((mechanics: Mechanic[]) => {
    return [...mechanics].sort((a, b) => (a.distance || 0) - (b.distance || 0));
  }, []);

  const updateDriverLocationName = useCallback(
    async (latitude: number, longitude: number, options: { force?: boolean } = {}) => {
      const lastResolvedLocation = lastResolvedLocationRef.current;
      const movedDistanceKm = lastResolvedLocation
        ? calculateDistance(
            lastResolvedLocation.latitude,
            lastResolvedLocation.longitude,
            latitude,
            longitude
          )
        : Number.POSITIVE_INFINITY;

      if (!options.force && movedDistanceKm < 0.05) {
        return;
      }

      lastResolvedLocationRef.current = { latitude, longitude };

      const locationName = await getLocationName(latitude, longitude);
      setDriverLocationName(locationName);
    },
    []
  );

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    setDriverMarkerTracksViewChanges(true);
    const timeout = setTimeout(() => {
      setDriverMarkerTracksViewChanges(false);
    }, 1200);

    return () => {
      clearTimeout(timeout);
    };
  }, [driverLocationName]);

  // Update filtered mechanics when mechanics change
  useEffect(() => {
    const filtered = filterMechanics(nearbyMechanics);
    setFilteredMechanics(filtered);
  }, [nearbyMechanics, filterMechanics]);

  // Set driver name from route params
  useEffect(() => {
    if (params.driverName) {
      setDriverName(params.driverName as string);
    }
  }, [params.driverName]);

  // Load driver info from AsyncStorage
  useEffect(() => {
    (async () => {
      const [savedPhotoUri, savedName] = await Promise.all([
        AsyncStorage.getItem(PROFILE_PHOTO_URI_KEY),
        AsyncStorage.getItem(DRIVER_NAME_KEY),
      ]);

      if (savedPhotoUri) {
        setProfilePhotoUri(savedPhotoUri);
      }
      if (savedName) {
        setDriverName(savedName);
      }
    })();
  }, []);

  // Initialize real-time location tracking
  useEffect(() => {
    let isActive = true;

    (async () => {
      // Clear legacy sample and existing shop data once. New registrations are retained.
      resetLegacyShopData()
        .then(removeDeletedShops)
        .catch((error) => {
          console.warn('Unable to clean legacy shop data:', error);
        });

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

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Location permission denied. Please enable location permissions in settings.');
        setLoading(false);
        // Load cached shops as fallback
        await loadCachedShops();
        return;
      }
      setLoading(false);

      try {
        const cachedLocation = await Location.getLastKnownPositionAsync({
          maxAge: 5 * 60 * 1000,
          requiredAccuracy: 5000,
        }).catch(() => null);
        let hasUsableLocation = false;

        if (cachedLocation && cachedLocation.coords.accuracy !== null && cachedLocation.coords.accuracy <= MAX_CACHED_LOCATION_ACCURACY_METERS) {
          const { latitude, longitude } = cachedLocation.coords;
          hasUsableLocation = true;
          applyMapLocation(latitude, longitude);
          updateDriverLocationName(latitude, longitude, { force: true }).catch(() => {});
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
          updateDriverLocationName(latitude, longitude, { force: true }).catch(() => {});
          updateNearbyMechanics(latitude, longitude, setNearbyMechanics).catch(() => {});
          updateNearbyMechanics(latitude, longitude, setNearbyMechanics, { forceRefresh: true }).catch(() => {});
        } else if (!hasUsableLocation) {
          setErrorMsg('Location services are taking longer than expected. Showing cached shops if available.');
          setLoading(false);
          await loadCachedShops();
        }

        // Start real-time location tracking
        locationWatcherRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 7000,
            distanceInterval: 25,
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

            updateDriverLocationName(newLat, newLon).catch(() => {});
            await updateNearbyMechanics(newLat, newLon, setNearbyMechanics);
          }
        );
      } catch (error) {
        console.error('Error getting location:', error);
        setErrorMsg('Location services unavailable. Make sure location is enabled and try again.');
        setLoading(false);
        // Load cached shops as fallback
        await loadCachedShops();
      }
    })();

    return () => {
      isActive = false;
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
      }
    };
  }, [updateDriverLocationName]);

  // Monitor network connectivity
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Load cached shops when needed
  const loadCachedShops = async () => {
    try {
      const [cachedShopsJson, timestampStr] = await AsyncStorage.multiGet([
        CACHED_NEARBY_SHOPS_KEY,
        CACHED_SHOPS_TIMESTAMP_KEY,
      ]);

      if (cachedShopsJson[1]) {
        const shops = removeUnavailableShopNames(JSON.parse(cachedShopsJson[1]));
        const timestamp = parseInt(timestampStr[1] || '0');
        setOfflineSearchData(shops);
        await AsyncStorage.setItem(CACHED_NEARBY_SHOPS_KEY, JSON.stringify(shops));
        setOfflineSearchTimestamp(timestamp);
        setOfflineDataAvailable(true);
        return true;
      }
    } catch (error) {
      console.error('Error loading cached shops:', error);
    }
    return false;
  };

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const savedPhotoUri = await AsyncStorage.getItem(PROFILE_PHOTO_URI_KEY);
        setProfilePhotoUri(savedPhotoUri);
      })();

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

  const resolveCurrentDriverLocationName = async () => {
    if (!driverLocation) {
      return driverLocationName === 'Finding your exact location...'
        ? 'Location not provided'
        : driverLocationName;
    }

    const locationName = await getLocationName(
      driverLocation.latitude,
      driverLocation.longitude
    );
    setDriverLocationName(locationName);
    return locationName;
  };

  const handleChat = async (mechanic: Mechanic) => {
    registerActivity();
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
    registerActivity();
    setSmsMechanic(mechanic);
  };

  const sendSMS = async (message: string) => {
    if (!smsMechanic || smsSending) {
      return;
    }

    const mechanic = smsMechanic;
    setSmsSending(true);

    try {
      const requestLocationName = await resolveCurrentDriverLocationName();
      await recordMechanicContactRequest({
        type: 'sms',
        provider: {
          id: mechanic.id,
          mechanicId: mechanic.mechanicId,
          name: mechanic.name,
          phone: mechanic.phone,
          location: getShopLocationLabel(mechanic),
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
    registerActivity();
    const callUrl = `tel:${mechanic.phone}`;
    Linking.openURL(callUrl).catch(() => {
      console.error('Unable to open phone dialer');
    });
  };

  const handleProfilePress = () => {
    registerActivity();
    router.push('/profile');
  };

  const handleHomePress = () => {
    registerActivity();
    if (drawerOpen) {
      setDrawerOpen(false);
    }
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
    if (isRefreshingMap) return;
    registerActivity();
    setIsRefreshingMap(true);
    try {
      if (driverLocation) {
        updateMapPosition(driverLocation.latitude, driverLocation.longitude);
        await updateNearbyMechanics(
          driverLocation.latitude,
          driverLocation.longitude,
          setNearbyMechanics,
          { forceRefresh: true }
        );
        updateDriverLocationName(driverLocation.latitude, driverLocation.longitude, { force: true }).catch(() => {});

        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then(({ coords: { latitude, longitude } }) => {
            updateMapPosition(latitude, longitude);
            updateDriverLocationName(latitude, longitude, { force: true }).catch(() => {});
          })
          .catch((error) => console.error('Unable to update precise location:', error));
        return;
      }

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
      updateDriverLocationName(latitude, longitude, { force: true }).catch(() => {});
      await updateNearbyMechanics(latitude, longitude, setNearbyMechanics, { forceRefresh: true });
    } catch (error) {
      console.error('Error refreshing location:', error);
    } finally {
      setIsRefreshingMap(false);
    }
  };

  const getShopLocationLabel = (mechanic: Mechanic) => {
    return mechanic.location || mechanic.city || mechanic.region || 'Location not provided';
  };

  const handleOfflineSearchOpen = async () => {
    // Try to fetch fresh data if online
    if (isOnline && driverLocation) {
      try {
        const freshShops = await fetchNearbyShops(
          driverLocation.latitude,
          driverLocation.longitude,
          Number.POSITIVE_INFINITY,
          { forceRefresh: true }
        );
        setOfflineSearchData(freshShops);
        setOfflineSearchTimestamp(Date.now());
        setOfflineDataAvailable(true);
      } catch (error) {
        console.error('Error fetching fresh shops, falling back to cache:', error);
        // Fall back to cache if fetch fails
        await loadCachedShops();
      }
    } else {
      // Not online, load from cache
      await loadCachedShops();
    }
    
    setOfflineSearchModalOpen(true);
  };

  // Show every nearby mechanic shop, ordered by distance.
  const displayedMechanics = nearbyMechanics;
  const displayedFilteredMechanics = filteredMechanics;

  return (
    <ThemedView style={styles.container}>
      {/* Header with Greeting and Profile */}
      <View style={styles.headerSection}>
        <TouchableOpacity 
          style={styles.menuIcon} 
          onPress={() => setDrawerOpen(true)}
        >
          <AppIcon name="menu" size={26} color="#333" />
        </TouchableOpacity>
        <View style={styles.greetingContainer}>
          <ThemedText style={styles.greetingText}>Hello, {driverName}</ThemedText>
        </View>
        <View style={styles.profileCircle}>
          {profilePhotoUri ? (
            <Image source={{ uri: profilePhotoUri }} style={styles.profileImage} />
          ) : (
            <ThemedText style={styles.profileInitial}>{driverName.charAt(0).toUpperCase()}</ThemedText>
          )}
        </View>
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
          <View style={styles.mapContainer} onTouchStart={registerActivity}>
            {region && driverLocation && (
              <MapView
                style={styles.map}
                initialRegion={region}
                region={region}
                ref={mapRef}
                loadingEnabled
                moveOnMarkerPress={false}
              >
                {/* Driver location marker - blue */}
                <Marker
                  coordinate={driverLocation}
                  title="Your Location"
                  description={driverLocationName}
                  anchor={{ x: 0.5, y: 1 }}
                  tracksViewChanges={Platform.OS === 'android' ? driverMarkerTracksViewChanges : false}
                  zIndex={1000}
                >
                  <View collapsable={false} renderToHardwareTextureAndroid style={styles.driverMarker}>
                    <LocationPin />
                  </View>
                </Marker>
                {/* Registered mechanic markers, ordered by distance from the driver */}
                {displayedMechanics.map((mechanic, index) => (
                    <Marker
                      key={mechanic.id}
                      coordinate={{
                        latitude: mechanic.latitude,
                        longitude: mechanic.longitude,
                      }}
                      title={mechanic.name}
                      description={`${(mechanic.distance || 0).toFixed(1)} km`}
                      anchor={{ x: 0.5, y: 1 }}
                      tracksViewChanges={Platform.OS === 'android'}
                      zIndex={500 - index}
                    >
                      <View style={styles.customMarker}>
                        <AppIcon name="wrench" size={18} color="#fff" />
                        <View style={styles.markerDistanceBadge}>
                          <ThemedText style={styles.markerDistanceText}>
                            {(mechanic.distance || 0).toFixed(1)} km
                          </ThemedText>
                        </View>
                      </View>
                    </Marker>
                  ))}
              </MapView>
            )}
            {/* Refresh Button */}
            <TouchableOpacity 
              style={styles.refreshButton}
              onPress={handleRefreshMap}
            >
              {isRefreshingMap ? (
                <ActivityIndicator size="small" color="#FF8C42" />
              ) : (
                <AppIcon name="refresh" size={22} color="#FF8C42" />
              )}
            </TouchableOpacity>
            <View style={styles.currentLocationBadge}>
              <AppIcon name="mapPin" size={16} color="#1D4ED8" strokeWidth={2.5} />
              <ThemedText style={styles.currentLocationBadgeText} numberOfLines={2}>
                {driverLocationName}
              </ThemedText>
            </View>
          </View>

          {/* Nearby Shops Dropdown */}
          <View style={styles.dropdownContainer} onTouchStart={registerActivity}>
            <TouchableOpacity
              style={styles.dropdownHeader}
              onPress={() => setDropdownOpen((open) => !open)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={dropdownOpen ? 'Collapse nearby shops' : 'Expand nearby shops'}
            >
              <View style={styles.dropdownHeaderLeft}>
                <Image source={mechanicShopImage} style={styles.shopCountIcon} />
                <View>
                  <ThemedText style={styles.dropdownTitle}>Nearby Shops</ThemedText>
                  <ThemedText style={styles.dropdownCount}>
                    {displayedMechanics.length} shops available
                  </ThemedText>
                </View>
              </View>
              <View
                style={styles.dropdownArrow}
              >
                {dropdownOpen ? (
                  <AppIcon name="chevronUp" size={18} color="#FF8C42" />
                ) : (
                  <AppIcon name="chevronDown" size={18} color="#FF8C42" />
                )}
              </View>
            </TouchableOpacity>
          </View>

          {/* Shop List */}
          {dropdownOpen && (
            <ScrollView
              style={styles.listContainer}
              contentContainerStyle={styles.listContentContainer}
              showsVerticalScrollIndicator={false}
              onScrollBeginDrag={registerActivity}
              onTouchStart={registerActivity}
            >
              {displayedFilteredMechanics.length > 0 ? (
                <View style={styles.shopsListWrapper}>
                  {displayedFilteredMechanics.map((mechanic, index) => (
                    <View key={mechanic.id}>
                      <View style={styles.shopItem}>
                        <View style={styles.shopCardHeader}>
                          <View style={styles.shopAvatar}>
                            <Image source={mechanicShopImage} style={styles.shopAvatarImage} />
                          </View>

                          <View style={styles.shopInfo}>
                            <View style={styles.shopTitleRow}>
                              <ThemedText style={styles.shopName} numberOfLines={1}>
                                {mechanic.name}
                              </ThemedText>
                              <View
                                style={[
                                  styles.availableBadge,
                                  mechanic.status === 'inactive' && styles.inactiveBadge,
                                ]}
                              >
                                <ThemedText
                                  style={[
                                    styles.availableText,
                                    mechanic.status === 'inactive' && styles.inactiveText,
                                  ]}
                                >
                                  {mechanic.status === 'inactive' ? 'Inactive' : 'Active'}
                                </ThemedText>
                              </View>
                            </View>

                            <View style={styles.shopLocationMetaRow}>
                              <ThemedText style={styles.shopLocation} numberOfLines={1}>
                                {getShopLocationLabel(mechanic)}
                              </ThemedText>
                              <View style={styles.metaPill}>
                                <ThemedText style={styles.metaPillText}>
                                  {(mechanic.distance || 0).toFixed(1)} km away
                                </ThemedText>
                              </View>
                              <View style={styles.metaPillSoft}>
                                <ThemedText style={styles.metaPillSoftText}>Verified location</ThemedText>
                              </View>
                            </View>
                          </View>
                        </View>

                        <View style={styles.shopActionsRow}>
                          <Pressable
                            style={({ hovered, pressed }) => [
                              styles.actionButtonBase,
                              styles.actionButtonChat,
                              (hovered || pressed) && styles.actionButtonChatActive,
                            ]}
                            onPress={() => handleChat(mechanic)}
                          >
                            {({ hovered, pressed }) => (
                              <ThemedText style={[
                                styles.actionButtonText,
                                (hovered || pressed) ? styles.actionButtonTextActive : styles.actionButtonTextChat,
                              ]}>
                                Chat
                              </ThemedText>
                            )}
                          </Pressable>
                          <Pressable
                            style={({ hovered, pressed }) => [
                              styles.actionButtonBase,
                              styles.actionButtonCall,
                              (hovered || pressed) && styles.actionButtonCallActive,
                            ]}
                            onPress={() => handleCall(mechanic)}
                          >
                            {({ hovered, pressed }) => (
                              <ThemedText style={[
                                styles.actionButtonText,
                                (hovered || pressed) ? styles.actionButtonTextActive : styles.actionButtonTextCall,
                              ]}>
                                Call
                              </ThemedText>
                            )}
                          </Pressable>
                          <Pressable
                            style={({ hovered, pressed }) => [
                              styles.actionButtonBase,
                              styles.actionButtonSms,
                              (hovered || pressed) && styles.actionButtonSmsActive,
                            ]}
                            onPress={() => handleSMS(mechanic)}
                          >
                            {({ hovered, pressed }) => (
                              <ThemedText style={[
                                styles.actionButtonText,
                                (hovered || pressed) ? styles.actionButtonTextActive : styles.actionButtonTextSms,
                              ]}>
                                SMS
                              </ThemedText>
                            )}
                          </Pressable>
                        </View>
                      </View>

                      {/* Divider */}
                      {index < filteredMechanics.length - 1 && (
                        <View style={styles.divider} />
                      )}
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <ThemedText style={styles.emptyStateText}>No mechanic shops available</ThemedText>
                </View>
              )}
            </ScrollView>
          )}
        </>
      )}

      {/* Bottom Navigation Bar */}
      <View style={styles.bottomNavWrapper}>
        <BottomNav 
          onHomePress={handleHomePress}
          onProfilePress={handleProfilePress}
          showProfile={true}
        />
      </View>

      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        driverName={driverName}
        role="driver"
      />

      {/* Offline Search Modal */}
      <Modal
        visible={offlineSearchModalOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setOfflineSearchModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <ThemedText style={styles.modalTitle}>Offline Search Results</ThemedText>
                <View style={styles.dataStatusBadge}>
                  <ThemedText style={[
                    styles.dataStatusText,
                    isOnline ? styles.dataStatusFresh : styles.dataStatusCached
                  ]}>
                    {isOnline ? '🟢 Live Data' : '🟡 Cached Data'} 
                    {offlineSearchTimestamp && ` • ${formatTimeAgo(offlineSearchTimestamp)}`}
                  </ThemedText>
                </View>
              </View>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setOfflineSearchModalOpen(false)}
              >
                <AppIcon name="close" size={22} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {/* Mechanic Shops Section */}
              <View style={styles.modalSection}>
                <View style={styles.modalSectionTitleRow}>
                  <AppIcon name="wrench" size={18} color="#333" />
                  <ThemedText style={styles.modalSectionTitle}>Mechanic Shops</ThemedText>
                </View>
                {offlineDataAvailable && offlineSearchData.length > 0 ? (
                  offlineSearchData.map((mechanic) => (
                    <View key={mechanic.id} style={styles.modalListItem}>
                      <View style={styles.modalItemLeft}>
                        <View style={styles.modalItemAvatar}>
                          <ThemedText style={styles.modalItemAvatarText}>
                            {mechanic.name.charAt(0).toUpperCase()}
                          </ThemedText>
                        </View>
                        <View style={styles.modalItemInfo}>
                          <ThemedText style={styles.modalItemName}>{mechanic.name}</ThemedText>
                          <ThemedText style={styles.modalItemSubtext}>
                            {getShopLocationLabel(mechanic)}
                          </ThemedText>
                          <ThemedText style={styles.modalItemDistance}>
                            {(mechanic.distance || 0).toFixed(1)} km away
                          </ThemedText>
                        </View>
                      </View>
                      <View style={styles.modalItemActions}>
                        <TouchableOpacity
                          style={styles.modalActionButton}
                          onPress={() => {
                            handleChat(mechanic);
                            setOfflineSearchModalOpen(false);
                          }}
                        >
                          <AppIcon name="message" size={18} color="#fff" style={styles.modalActionIcon} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.modalActionButton}
                          onPress={() => {
                            handleCall(mechanic);
                            setOfflineSearchModalOpen(false);
                          }}
                        >
                          <AppIcon name="phone" size={18} color="#fff" style={styles.modalActionIcon} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                ) : (
                  <ThemedText style={styles.modalEmptyText}>
                    {offlineDataAvailable ? 'No shops available' : 'No cached data available. Please ensure you have internet connection to load shop data first.'}
                  </ThemedText>
                )}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.modalCloseFullButton}
              onPress={() => setOfflineSearchModalOpen(false)}
            >
              <ThemedText style={styles.modalCloseFullButtonText}>Close</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: IS_IOS ? 58 : 50,
    paddingBottom: IS_IOS ? 18 : 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  greetingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  greetingText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  menuIcon: {
    padding: IS_IOS ? 12 : 10,
  },
  menuIconText: {
    fontSize: 24,
    color: '#000',
  },
  profileCircle: {
    width: IS_IOS ? 50 : 45,
    height: IS_IOS ? 50 : 45,
    borderRadius: IS_IOS ? 25 : 22.5,
    backgroundColor: '#3498db',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#2980b9',
  },
  profileInitial: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  profileImage: {
    width: '100%',
    height: '100%',
    borderRadius: IS_IOS ? 25 : 22.5,
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: IS_IOS ? 52 : 48,
  },
  searchIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: IS_IOS ? 15 : 14,
    color: '#333',
    padding: 0,
  },
  clearButton: {
    fontSize: 20,
    color: '#999',
    marginLeft: 8,
    fontWeight: 'bold',
  },
  mapContainer: {
    height: 200,
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
  customMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 5,
    position: 'relative',
    marginBottom: 20,
  },
  markerDistanceBadge: {
    position: 'absolute',
    top: 42,
    minWidth: 48,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'center',
  },
  markerDistanceText: {
    color: '#1D4ED8',
    fontSize: 9,
    fontWeight: '800',
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
  currentLocationBadge: {
    position: 'absolute',
    left: 12,
    right: 64,
    bottom: 12,
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
    elevation: 4,
  },
  currentLocationBadgeText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    color: '#1F2937',
  },
  markerIcon: {
    fontSize: 20,
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
  },
  listContentContainer: {
    paddingBottom: 140,
  },
  shopsListWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shopItem: {
    flexDirection: 'column',
    alignItems: 'stretch',
    padding: IS_IOS ? 18 : 16,
    marginBottom: IS_IOS ? 14 : 12,
    borderRadius: IS_IOS ? 20 : 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E7DE',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },
  shopCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  shopAvatar: {
    width: IS_IOS ? 54 : 48,
    height: IS_IOS ? 54 : 48,
    borderRadius: IS_IOS ? 18 : 16,
    backgroundColor: '#FFF3E8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF8C42',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 2,
    overflow: 'hidden',
  },
  shopAvatarImage: {
    width: IS_IOS ? 54 : 48,
    height: IS_IOS ? 54 : 48,
    resizeMode: 'cover',
  },
  shopAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  shopInfo: {
    flex: 1,
  },
  shopTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  shopName: {
    flex: 1,
    fontSize: IS_IOS ? 19 : 18,
    fontWeight: '800',
    color: '#1F2937',
    lineHeight: IS_IOS ? 24 : 22,
    flexShrink: 1,
  },
  shopLocationMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  metaPill: {
    backgroundColor: '#FFF4EA',
    borderRadius: 999,
    paddingHorizontal: IS_IOS ? 12 : 10,
    paddingVertical: IS_IOS ? 7 : 6,
  },
  metaPillText: {
    fontSize: IS_IOS ? 13 : 12,
    fontWeight: '700',
    color: '#C96A20',
  },
  metaPillSoft: {
    backgroundColor: '#F4F7FB',
    borderRadius: 999,
    paddingHorizontal: IS_IOS ? 12 : 10,
    paddingVertical: IS_IOS ? 7 : 6,
  },
  metaPillSoftText: {
    fontSize: IS_IOS ? 13 : 12,
    fontWeight: '700',
    color: '#586174',
  },
  shopDistance: {
    fontSize: IS_IOS ? 14 : 13,
    color: '#666',
  },
  shopLocation: {
    flex: 1,
    minWidth: 120,
    fontSize: IS_IOS ? 14 : 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  shopActions: {
    display: 'none',
  },
  shopActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  actionButtonBase: {
    flex: 1,
    height: IS_IOS ? 48 : 42,
    borderRadius: IS_IOS ? 14 : 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
  },
  actionButtonChat: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  actionButtonChatActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
    transform: [{ translateY: -1 }],
  },
  actionButtonCall: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  actionButtonCallActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
    transform: [{ translateY: -1 }],
  },
  actionButtonSms: {
    backgroundColor: '#F5F3FF',
    borderColor: '#DDD6FE',
  },
  actionButtonSmsActive: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
    transform: [{ translateY: -1 }],
  },
  actionButtonText: {
    fontSize: IS_IOS ? 15 : 14,
    fontWeight: '700',
  },
  actionButtonTextActive: {
    color: '#fff',
  },
  actionButtonTextChat: {
    color: '#1D4ED8',
  },
  actionButtonTextCall: {
    color: '#047857',
  },
  actionButtonTextSms: {
    color: '#6D28D9',
  },
  availableBadge: {
    paddingHorizontal: IS_IOS ? 12 : 10,
    paddingVertical: IS_IOS ? 7 : 6,
    backgroundColor: '#ECFDF3',
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  availableText: {
    fontSize: IS_IOS ? 13 : 12,
    fontWeight: '700',
    color: '#059669',
  },
  inactiveBadge: {
    backgroundColor: '#FEF2F2',
  },
  inactiveText: {
    color: '#DC2626',
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
  bottomNavWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  dropdownContainer: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#FFE0CC',
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fffaf6',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  dropdownHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  shopCountIcon: {
    width: 48,
    height: 48,
    marginRight: 12,
    resizeMode: 'contain',
  },
  dropdownTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  dropdownCount: {
    fontSize: 12,
    color: '#FF8C42',
    fontWeight: '600',
  },
  dropdownArrow: {
    fontSize: 12,
    color: '#999',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  dropdownArrowOpen: {
    color: '#FF8C42',
  },
  dropdownList: {
    backgroundColor: '#fff',
    maxHeight: 420,
    paddingBottom: 20,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 20,
  },
  dropdownItemInfo: {
    flex: 1,
  },
  dropdownItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  dropdownItemDistance: {
    fontSize: 12,
    color: '#666',
  },
  dropdownItemLocation: {
    fontSize: 12,
    color: '#FF8C42',
    fontWeight: '600',
    marginBottom: 2,
  },
  dropdownItemDivider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 16,
  },
  dropdownEmptyState: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  dropdownEmptyText: {
    fontSize: 13,
    color: '#999',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingTop: 16,
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  dataStatusBadge: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  dataStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  dataStatusFresh: {
    color: '#27AE60',
  },
  dataStatusCached: {
    color: '#FF9800',
  },
  modalCloseButton: {
    padding: 8,
  },
  modalScroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  modalSection: {
    marginBottom: 24,
  },
  modalSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  modalSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FF8C42',
  },
  modalListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    marginBottom: 10,
  },
  modalItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  modalItemAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FF8C42',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  modalItemAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  modalItemInfo: {
    flex: 1,
  },
  modalItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  modalItemSubtext: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  modalItemDistance: {
    fontSize: 11,
    color: '#FF8C42',
    fontWeight: '600',
  },
  modalItemActions: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 8,
  },
  modalActionButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#FF8C42',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalActionIcon: {
    fontSize: 16,
  },
  modalEmptyText: {
    textAlign: 'center',
    fontSize: 14,
    color: '#999',
    paddingVertical: 20,
  },
  modalCloseFullButton: {
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FF8C42',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseFullButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});

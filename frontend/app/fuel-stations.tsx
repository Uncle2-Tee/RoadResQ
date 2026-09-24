import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { AppIcon } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { Drawer } from '../components/drawer';
import MapView, { Marker, Polyline, type NativeMapView } from '../components/native-map';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { fetchNearbyFuelStations, type FuelStation } from '../services/api-client';
import { calculateDistanceKm, getProviderDistanceText } from '../services/location-geofence';
import { getLocationName } from '../services/location-label';

const DRIVER_NAME_KEY = 'driverName';
const MAX_CACHED_LOCATION_ACCURACY_METERS = 250;

const fallbackFuelStations: FuelStation[] = [
  { id: 'fallback-ho-shell', name: 'Shell Ho Filling Station', latitude: 6.6053, longitude: -0.4682, address: 'Ho Township, Volta Region', brand: 'Shell' },
  { id: 'fallback-ho-total', name: 'Total Energies Ho', latitude: 6.6092, longitude: -0.4754, address: 'Ho Central, Volta Region', brand: 'Total' },
  { id: 'fallback-ho-goil', name: 'GOIL Ho Station', latitude: 6.5984, longitude: -0.4721, address: 'Ho Main Road, Volta Region', brand: 'GOIL' },
  { id: 'fallback-ho-puma', name: 'Puma Energy Ho', latitude: 6.5918, longitude: -0.4688, address: 'Ho Market Area, Volta Region', brand: 'Puma' },
  { id: 'fallback-ho-fuelhub', name: 'Fuel Hub Ho', latitude: 6.6177, longitude: -0.4776, address: 'Ho Business District, Volta Region', brand: 'Fuel Hub' },
  { id: 'fallback-ho-ghana', name: 'Ghana Oil Ho', latitude: 6.5861, longitude: -0.4699, address: 'Ho South, Volta Region', brand: 'Ghana Oil' },
];

export default function FuelStationsScreen() {
  const mapRef = useRef<NativeMapView>(null);
  const [driverName, setDriverName] = useState('Driver');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [driverLocationName, setDriverLocationName] = useState('Finding your exact location...');
  const [region, setRegion] = useState<{ latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [fuelStations, setFuelStations] = useState<FuelStation[]>([]);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(DRIVER_NAME_KEY).then((savedName) => {
      if (savedName) setDriverName(savedName);
    });
  }, []);

  useEffect(() => {
    if (!driverLocation) return;
    let active = true;
    getLocationName(driverLocation.latitude, driverLocation.longitude).then((name) => {
      if (active) setDriverLocationName(name);
    });
    return () => { active = false; };
  }, [driverLocation]);

  const applyLocation = useCallback((latitude: number, longitude: number, animate = false) => {
    const nextRegion = { latitude, longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 };
    setDriverLocation({ latitude, longitude });
    setRegion(nextRegion);
    if (animate) mapRef.current?.animateToRegion(nextRegion, 250);
  }, []);

  const nearbyStations = useMemo(() => {
    if (!driverLocation) return [];

    return [...fuelStations]
      .map((station) => {
        const distanceKm = calculateDistanceKm(
          driverLocation.latitude,
          driverLocation.longitude,
          station.latitude,
          station.longitude
        );

        return { ...station, distanceKm };
      })
      .filter((station) => station.distanceKm >= 1 && station.distanceKm <= 30)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 12);
  }, [driverLocation, fuelStations]);

  const selectedStation = useMemo(
    () => nearbyStations.find((station) => station.id === selectedStationId) ?? null,
    [nearbyStations, selectedStationId]
  );

  useEffect(() => {
    if (nearbyStations.length > 0 && !selectedStationId) {
      setSelectedStationId(nearbyStations[0].id);
    }
  }, [nearbyStations, selectedStationId]);

  const loadCurrentLocation = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Location permission is required to find nearby fuel stations.');
        setLoading(false);
        return;
      }

      const cached = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 5000 });
      if (cached && cached.coords.accuracy !== null && cached.coords.accuracy <= MAX_CACHED_LOCATION_ACCURACY_METERS) {
        applyLocation(cached.coords.latitude, cached.coords.longitude);
      }

      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      applyLocation(location.coords.latitude, location.coords.longitude, true);
      setErrorMsg(null);
    } catch (error) {
      console.error('Unable to load driver location for fuel stations:', error);
      setErrorMsg('Unable to load your current location. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [applyLocation]);

  useEffect(() => {
    if (!driverLocation) {
      return;
    }

    let active = true;

    (async () => {
      let stations: FuelStation[];
      try {
        const liveStations = await fetchNearbyFuelStations(driverLocation.latitude, driverLocation.longitude);
        const stationKeys = new Set(liveStations.map((station) => `${station.latitude.toFixed(5)}:${station.longitude.toFixed(5)}`));
        stations = [
          ...liveStations,
          ...fallbackFuelStations.filter(
            (station) => !stationKeys.has(`${station.latitude.toFixed(5)}:${station.longitude.toFixed(5)}`)
          ),
        ];
      } catch (error) {
        console.warn('Unable to fetch fuel stations from the backend, using fallback data instead:', error);
        stations = fallbackFuelStations;
      }
      if (!active) {
        return;
      }
      setFuelStations(stations);
    })();

    return () => {
      active = false;
    };
  }, [driverLocation]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (active) {
            setErrorMsg('Location permission is required to find nearby fuel stations.');
            setLoading(false);
          }
          return;
        }

        const cached = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 5000 });
        if (active && cached && cached.coords.accuracy !== null && cached.coords.accuracy <= MAX_CACHED_LOCATION_ACCURACY_METERS) {
          applyLocation(cached.coords.latitude, cached.coords.longitude);
        }

        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!active) return;
        applyLocation(current.coords.latitude, current.coords.longitude, true);
        setErrorMsg(null);
        setLoading(false);

        locationWatcherRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
          ({ coords }) => {
            if (!active) return;
            applyLocation(coords.latitude, coords.longitude);
          }
        );
      } catch (error) {
        console.error('Unable to track location for fuel stations:', error);
        if (active) {
          setErrorMsg('Unable to load your current location. Please try again.');
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      locationWatcherRef.current?.remove();
      locationWatcherRef.current = null;
    };
  }, [applyLocation]);

  const focusOnStation = (station: FuelStation) => {
    setSelectedStationId(station.id);
    if (!driverLocation) {
      return;
    }

    const latitudeDelta = Math.max(0.08, Math.abs(driverLocation.latitude - station.latitude) * 2.3 + 0.02);
    const longitudeDelta = Math.max(0.08, Math.abs(driverLocation.longitude - station.longitude) * 2.3 + 0.02);
    const nextRegion = {
      latitude: (driverLocation.latitude + station.latitude) / 2,
      longitude: (driverLocation.longitude + station.longitude) / 2,
      latitudeDelta,
      longitudeDelta,
    };

    setRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 250);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await loadCurrentLocation(false);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerContainer}>
        <TouchableOpacity style={styles.menuIcon} onPress={() => setDrawerOpen(true)} accessibilityLabel="Open menu">
          <AppIcon name="menu" size={26} color="#333" />
        </TouchableOpacity>
        <ThemedText type="title" style={styles.title}>Nearby fuel filling stations</ThemedText>
      </View>

      {errorMsg ? (
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>{errorMsg}</ThemedText>
          <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
            <ThemedText style={styles.retryText}>Try again</ThemedText>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF8C42" />
          <ThemedText style={styles.loadingText}>Loading nearby stations…</ThemedText>
        </View>
      ) : (
        <>
          <View style={styles.mapContainer}>
            {region && driverLocation && (
              <MapView style={styles.map} initialRegion={region} region={region} ref={mapRef} loadingEnabled moveOnMarkerPress={false} showsUserLocation showsMyLocationButton>
                <Marker coordinate={driverLocation} title="Your current location" description={driverLocationName} anchor={{ x: 0.5, y: 1 }} zIndex={1000} pinColor="#2563EB" tracksViewChanges={false}>
                  <View style={styles.driverMarker}>
                    <View style={styles.driverAccuracyRing}>
                      <View style={styles.driverLocationDot} />
                    </View>
                  </View>
                </Marker>

                {selectedStation && driverLocation && (
                  <Polyline
                    coordinates={[
                      { latitude: driverLocation.latitude, longitude: driverLocation.longitude },
                      { latitude: selectedStation.latitude, longitude: selectedStation.longitude },
                    ]}
                    strokeColor="#FF8C42"
                    strokeWidth={4}
                  />
                )}

                {nearbyStations.map((station, index) => (
                  <Marker
                    key={station.id}
                    coordinate={{ latitude: station.latitude, longitude: station.longitude }}
                    title={station.name}
                    description={getProviderDistanceText(station.distanceKm, station.brand)}
                    pinColor={selectedStationId === station.id ? '#16A34A' : '#FF8C42'}
                    zIndex={selectedStationId === station.id ? 600 : 500 - index}
                    tracksViewChanges={false}
                    onPress={() => setSelectedStationId(station.id)}
                  />
                ))}
              </MapView>
            )}

            <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh} accessibilityLabel="Refresh fuel stations">
              {isRefreshing ? <ActivityIndicator size="small" color="#FF8C42" /> : <AppIcon name="refresh" size={22} color="#FF8C42" />}
            </TouchableOpacity>

            {driverLocation && (
              <View style={styles.locationBanner} pointerEvents="none">
                <AppIcon name="mapPin" size={16} color="#1D4ED8" strokeWidth={2.5} />
                <ThemedText style={styles.locationBannerText} numberOfLines={2}>{driverLocationName}</ThemedText>
              </View>
            )}
          </View>

          <FlatList
            style={styles.listContainer}
            contentContainerStyle={styles.listContentContainer}
            showsVerticalScrollIndicator={false}
            data={nearbyStations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.stationCard}>
                <View style={styles.stationHeader}>
                  <View style={styles.stationIconContainer}>
                    <AppIcon name="fuel" size={24} color="#FF8C42" />
                  </View>

                  <View style={styles.stationInfo}>
                    <ThemedText style={styles.stationName}>{item.name}</ThemedText>
                    <ThemedText style={styles.stationAddress}>{item.address}</ThemedText>
                    <View style={styles.distanceRow}>
                      <ThemedText style={styles.distanceText}>{getProviderDistanceText(item.distanceKm, item.brand)}</ThemedText>
                    </View>
                  </View>
                </View>

                <TouchableOpacity style={styles.directionsButton} onPress={() => focusOnStation(item)} accessibilityLabel={`Show route to ${item.name}`}>
                  <AppIcon name="target" size={18} color="#fff" />
                  <ThemedText style={styles.directionsText}>Directions</ThemedText>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <AppIcon name="fuel" size={50} color="#999" />
                <ThemedText style={styles.emptyText}>No nearby fuel stations found.</ThemedText>
              </View>
            }
          />
        </>
      )}

      <BottomNav />
      <Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} driverName={driverName} role="driver" />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  headerContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 45, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e0e0e0' },
  menuIcon: { padding: 8, marginRight: 10 },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: '#333' },
  mapContainer: { height: 220, borderRadius: 12, overflow: 'hidden', margin: 16, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#e8e8e8', position: 'relative' },
  map: { flex: 1 },
  refreshButton: { position: 'absolute', top: 12, right: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3, zIndex: 10 },
  driverMarker: { width: 52, height: 52, justifyContent: 'center', alignItems: 'center', elevation: 7, shadowColor: '#1E40AF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 4 },
  driverAccuracyRing: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(37, 99, 235, 0.2)', borderWidth: 2, borderColor: '#FFFFFF' },
  driverLocationDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#2563EB', borderWidth: 2, borderColor: '#FFFFFF' },
  locationBanner: { position: 'absolute', left: 12, right: 64, bottom: 12, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255, 255, 255, 0.95)', borderWidth: 1, borderColor: '#DBEAFE', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 5, elevation: 4 },
  locationBannerText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '800', color: '#1F2937' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { textAlign: 'center', fontSize: 16, color: '#d32f2f', marginBottom: 16 },
  retryButton: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: '#FF8C42' },
  retryText: { color: '#fff', fontWeight: '700' },
  listContainer: { flex: 1 },
  listContentContainer: { paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 100 },
  stationCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#F0E7DE', padding: 14, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  stationHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stationIconContainer: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#FFF4EA', alignItems: 'center', justifyContent: 'center' },
  stationInfo: { flex: 1 },
  stationName: { fontSize: 18, fontWeight: '800', color: '#1F2937', marginBottom: 4 },
  stationAddress: { fontSize: 13, color: '#6B7280', marginBottom: 8 },
  distanceRow: { marginTop: 4 },
  distanceText: { fontSize: 13, fontWeight: '700', color: '#C96A20' },
  directionsButton: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FF8C42', borderRadius: 12, paddingVertical: 12 },
  directionsText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyState: { alignItems: 'center', paddingVertical: 50 },
  emptyText: { fontSize: 16, color: '#999', textAlign: 'center', marginTop: 12 },
});

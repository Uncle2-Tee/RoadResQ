import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Platform, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { AppIcon } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { Drawer } from '../components/drawer';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import MapView, { Marker, type NativeMapView } from '../components/native-map';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { getMechanicShops } from '../services/api-client';
import { saveDriverLocation } from '../services/driver-location-cache';
import { getLocationName } from '../services/location-label';
import { calculateDistance } from '../services/location-service';
import { recordTowRequest } from '../services/request-history-recorder';

const DRIVER_NAME_KEY = 'driverName';
const TOW_STATUS_REFRESH_MS = 10000;
const MAX_CACHED_LOCATION_ACCURACY_METERS = 250;
const towImage = require('../assets/images/tow.jpg');
const IS_IOS = Platform.OS === 'ios';

type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
type TowService = {
  id: string;
  mechanicId?: string | null;
  name: string;
  phone: string;
  location: string;
  latitude: number;
  longitude: number;
  distance: number;
  estimatedTime: number;
  status: 'active' | 'inactive';
};

const inactiveBadgeStyle = { backgroundColor: '#FEF2F2' };
const inactiveTextStyle = { color: '#DC2626' };

async function fetchTowServices(latitude: number, longitude: number, forceRefresh = false) {
  const shops = await getMechanicShops({
    forceRefresh,
    providerType: 'tow',
    includeInactive: true,
    databaseOnly: true,
  });
  return shops
    .filter((shop) => String(shop.providerType || '').trim().toLowerCase() === 'tow')
    .map<TowService>((shop) => {
      const distance = calculateDistance(latitude, longitude, shop.latitude, shop.longitude);
      return {
        id: shop.shopId || shop.id,
        mechanicId: shop.mechanicId,
        name: shop.shopName,
        phone: shop.phone,
        location: shop.location,
        latitude: shop.latitude,
        longitude: shop.longitude,
        distance,
        estimatedTime: Math.max(5, Math.ceil((distance / 40) * 60)),
        status: String(shop.status || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

export default function TowRequestScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const mapRef = useRef<NativeMapView>(null);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [driverLocationName, setDriverLocationName] = useState('Finding your exact location...');
  const [towServices, setTowServices] = useState<TowService[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [driverName, setDriverName] = useState((params.driverName as string) || 'Driver');

  const updateServices = useCallback(async (latitude: number, longitude: number, forceRefresh = false) => {
    try {
      setTowServices(await fetchTowServices(latitude, longitude, forceRefresh));
      setErrorMsg(null);
    } catch (error) {
      console.error('Unable to load towing services:', error);
      setErrorMsg(error instanceof Error ? error.message : 'Unable to load towing services from the database.');
    }
  }, []);

  const applyLocation = useCallback((latitude: number, longitude: number, animate = false) => {
    const nextRegion = { latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 };
    setDriverLocation({ latitude, longitude });
    setRegion(nextRegion);
    saveDriverLocation(latitude, longitude).catch(() => {});
    if (animate) mapRef.current?.animateToRegion(nextRegion, 250);
  }, []);

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

  useEffect(() => {
    let active = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Location permission denied. Please enable location permissions to find towing services.');
        setLoading(false);
        return;
      }
      try {
        const cached = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 5000 });
        if (cached && active && cached.coords.accuracy !== null && cached.coords.accuracy <= MAX_CACHED_LOCATION_ACCURACY_METERS) {
          applyLocation(cached.coords.latitude, cached.coords.longitude);
          updateServices(cached.coords.latitude, cached.coords.longitude);
          setLoading(false);
        }
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!active) return;
        applyLocation(location.coords.latitude, location.coords.longitude);
        await updateServices(location.coords.latitude, location.coords.longitude, true);
        setLoading(false);
        locationWatcherRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
          ({ coords }) => {
            applyLocation(coords.latitude, coords.longitude);
            updateServices(coords.latitude, coords.longitude);
          }
        );
      } catch (error) {
        console.error('Unable to get location:', error);
        if (active) {
          setErrorMsg('Unable to fetch your location. Please try refreshing.');
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
      locationWatcherRef.current?.remove();
      locationWatcherRef.current = null;
    };
  }, [applyLocation, updateServices]);

  useFocusEffect(useCallback(() => {
    if (!driverLocation) return;
    const refresh = () => updateServices(driverLocation.latitude, driverLocation.longitude, true);
    refresh();
    const timer = setInterval(refresh, TOW_STATUS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [driverLocation, updateServices]));

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      applyLocation(location.coords.latitude, location.coords.longitude, true);
      await updateServices(location.coords.latitude, location.coords.longitude, true);
      setErrorMsg(null);
    } catch (error) {
      console.error('Unable to refresh towing services:', error);
      setErrorMsg('Unable to refresh your location. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const recordRequest = (service: TowService, problemDescription?: string) =>
    recordTowRequest({ service, driverName, driverLocation: driverLocationName, problemDescription });

  const handleCall = async (service: TowService) => {
    try {
      await recordRequest(service);
      await Linking.openURL(`tel:${service.phone.replace(/[^\d+]/g, '')}`);
    } catch (error) {
      console.error('Unable to open phone dialer:', error);
    }
  };

  const handleSMS = async (service: TowService) => {
    try {
      await recordRequest(service);
      await Linking.openURL(`sms:${service.phone.replace(/[^\d+]/g, '')}`);
    } catch (error) {
      console.error('Unable to open SMS app:', error);
    }
  };

  const handleChat = (service: TowService) => {
    router.push({
      pathname: '/mechanic-chat',
      params: {
        role: 'driver',
        driverName,
        mechanicName: service.name,
        mechanicPhone: service.phone,
        mechanicId: service.mechanicId || service.id,
        requestType: 'tow',
        serviceId: service.id,
        servicePrice: '0',
        serviceEstimatedTime: String(service.estimatedTime),
        driverLocation: driverLocationName,
      },
    });
  };

  return <ThemedView style={styles.container}>
    <View style={styles.headerContainer}>
      <TouchableOpacity style={styles.menuIcon} onPress={() => setDrawerOpen(true)} accessibilityLabel="Open menu"><AppIcon name="menu" size={26} color="#333" /></TouchableOpacity>
      <ThemedText type="title" style={styles.title}>Nearby Towing Services</ThemedText>
    </View>
    {errorMsg ? <View style={styles.errorContainer}>
      <ThemedText style={styles.errorText}>{errorMsg}</ThemedText>
      <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}><ThemedText style={styles.retryText}>Try again</ThemedText></TouchableOpacity>
    </View> : loading ? <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#FF8C42" /><ThemedText style={styles.loadingText}>Loading map…</ThemedText>
    </View> : <>
      <View style={styles.mapContainer}>
        {region && driverLocation && <MapView style={styles.map} initialRegion={region} region={region} ref={mapRef} loadingEnabled moveOnMarkerPress={false}>
          <Marker coordinate={driverLocation} title="Your Location" description={driverLocationName} anchor={{ x: 0.5, y: 1 }} zIndex={1000} tracksViewChanges={false}>
            <View style={styles.driverMarker}><AppIcon name="mapPin" size={46} color="#2563EB" strokeWidth={3.2} /></View>
          </Marker>
          {towServices.slice(0, 3).map((service, index) => <Marker key={service.id} coordinate={{ latitude: service.latitude, longitude: service.longitude }} title={service.name} description={`${service.distance.toFixed(1)} km away`} pinColor="#FF8C42" zIndex={500 - index} tracksViewChanges={false} />)}
        </MapView>}
        <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh} accessibilityLabel="Refresh towing services">
          {isRefreshing ? <ActivityIndicator size="small" color="#FF8C42" /> : <AppIcon name="refresh" size={22} color="#FF8C42" />}
        </TouchableOpacity>
        {driverLocation && <View style={styles.locationBanner} pointerEvents="none"><AppIcon name="mapPin" size={16} color="#1D4ED8" strokeWidth={2.5} /><ThemedText style={styles.locationBannerText} numberOfLines={2}>{driverLocationName}</ThemedText></View>}
      </View>
      <FlatList style={styles.listContainer} contentContainerStyle={styles.listContentContainer} showsVerticalScrollIndicator={false} data={towServices} keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.shopCard}>
            <View style={styles.shopCardHeader}>
              <View style={styles.shopAvatar}>
                <Image source={towImage} style={styles.shopAvatarImage} resizeMode="cover" />
              </View>
              <View style={styles.shopInfo}>
                <View style={styles.shopTitleRow}>
                  <ThemedText style={styles.shopName} numberOfLines={1} ellipsizeMode="tail">{item.name}</ThemedText>
                  <View style={[styles.availableBadge, item.status === 'inactive' && inactiveBadgeStyle]}>
                    <ThemedText style={[styles.availableText, item.status === 'inactive' && inactiveTextStyle]}>
                      {item.status === 'inactive' ? 'Inactive' : 'Active'}
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.shopLocationMetaRow}>
                  <ThemedText style={styles.shopLocation} numberOfLines={1}>{item.location || 'Location not provided'}</ThemedText>
                  <View style={styles.metaPill}>
                    <ThemedText style={styles.metaPillText}>{item.distance.toFixed(1)} km away</ThemedText>
                  </View>
                  <View style={styles.metaPillSoft}>
                    <ThemedText style={styles.metaPillSoftText}>Verified location</ThemedText>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.shopActionsRow}>
              <TouchableOpacity style={[styles.actionButtonBase, styles.actionButtonChat]} onPress={() => handleChat(item)} accessibilityLabel={`Chat with ${item.name}`}>
                <ThemedText style={[styles.actionButtonText, styles.actionButtonTextChat]}>Chat</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButtonBase, styles.actionButtonCall]} onPress={() => handleCall(item)} accessibilityLabel={`Call ${item.name}`}>
                <ThemedText style={[styles.actionButtonText, styles.actionButtonTextCall]}>Call</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButtonBase, styles.actionButtonSms]} onPress={() => handleSMS(item)} accessibilityLabel={`Message ${item.name}`}>
                <ThemedText style={[styles.actionButtonText, styles.actionButtonTextSms]}>SMS</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<View style={styles.emptyState}><AppIcon name="car" size={50} color="#999" /><ThemedText style={styles.emptyText}>No towing services available</ThemedText><TouchableOpacity style={styles.retryButton} onPress={handleRefresh}><ThemedText style={styles.retryText}>Refresh</ThemedText></TouchableOpacity></View>}
      />
    </>}
    <BottomNav /><Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} driverName={driverName} role="driver" />
  </ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  headerContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 45, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e0e0e0' },
  menuIcon: { padding: 8, marginRight: 10 }, title: { flex: 1, fontSize: 18, fontWeight: '600', color: '#333' },
  mapContainer: { height: 200, borderRadius: 12, overflow: 'hidden', margin: 16, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#e8e8e8', position: 'relative' }, map: { flex: 1 },
  refreshButton: { position: 'absolute', top: 12, right: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3, zIndex: 10 },
  driverMarker: { width: 52, height: 52, justifyContent: 'center', alignItems: 'center', elevation: 7, shadowColor: '#1E40AF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 4 },
  locationBanner: { position: 'absolute', left: 12, right: 64, bottom: 12, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255, 255, 255, 0.95)', borderWidth: 1, borderColor: '#DBEAFE', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 5, elevation: 4 }, locationBannerText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '800', color: '#1F2937' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' }, loadingText: { marginTop: 12, fontSize: 16, color: '#666' }, errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }, errorText: { textAlign: 'center', fontSize: 16, color: '#d32f2f', marginBottom: 16 },
  retryButton: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6, backgroundColor: '#FF8C42', marginTop: 14 }, retryText: { color: '#fff', fontWeight: '700' }, listContainer: { flex: 1 }, listContentContainer: { paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 100 },
  shopCard: { flexDirection: 'column', alignItems: 'stretch', padding: IS_IOS ? 18 : 16, marginBottom: IS_IOS ? 14 : 12, borderRadius: IS_IOS ? 20 : 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F0E7DE', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 }, shopCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, shopAvatar: { width: IS_IOS ? 54 : 48, height: IS_IOS ? 54 : 48, borderRadius: IS_IOS ? 18 : 16, backgroundColor: '#FFF3E8', justifyContent: 'center', alignItems: 'center', shadowColor: '#FF8C42', shadowOpacity: 0.25, shadowRadius: 10, elevation: 2, overflow: 'hidden' }, shopAvatarImage: { width: IS_IOS ? 54 : 48, height: IS_IOS ? 54 : 48, resizeMode: 'cover' }, shopInfo: { flex: 1 }, shopTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }, shopName: { flex: 1, fontSize: IS_IOS ? 19 : 18, fontWeight: '800', color: '#1F2937', lineHeight: IS_IOS ? 24 : 22, flexShrink: 1 }, shopLocationMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 2 }, metaPill: { backgroundColor: '#FFF4EA', borderRadius: 999, paddingHorizontal: IS_IOS ? 12 : 10, paddingVertical: IS_IOS ? 7 : 6 }, metaPillText: { fontSize: IS_IOS ? 13 : 12, fontWeight: '700', color: '#C96A20' }, metaPillSoft: { backgroundColor: '#F4F7FB', borderRadius: 999, paddingHorizontal: IS_IOS ? 12 : 10, paddingVertical: IS_IOS ? 7 : 6 }, metaPillSoftText: { fontSize: IS_IOS ? 13 : 12, fontWeight: '700', color: '#586174' }, shopLocation: { flex: 1, minWidth: 120, fontSize: IS_IOS ? 14 : 13, color: '#6B7280', fontWeight: '500' }, shopActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }, actionButtonBase: { flex: 1, height: IS_IOS ? 48 : 42, borderRadius: IS_IOS ? 14 : 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5 }, actionButtonChat: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }, actionButtonCall: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }, actionButtonSms: { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }, actionButtonText: { fontSize: IS_IOS ? 15 : 14, fontWeight: '700' }, actionButtonTextChat: { color: '#1D4ED8' }, actionButtonTextCall: { color: '#047857' }, actionButtonTextSms: { color: '#6D28D9' }, availableBadge: { paddingHorizontal: IS_IOS ? 12 : 10, paddingVertical: IS_IOS ? 7 : 6, backgroundColor: '#ECFDF3', borderRadius: 999, alignSelf: 'flex-start' }, availableText: { fontSize: IS_IOS ? 13 : 12, fontWeight: '700', color: '#059669' },
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 16 }, emptyText: { fontSize: 16, color: '#999', textAlign: 'center', marginTop: 12 },
});

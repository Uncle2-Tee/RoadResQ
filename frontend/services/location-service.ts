import AsyncStorage from '@react-native-async-storage/async-storage';

import { getMechanicShops, type MechanicShopItem } from './api-client';

export interface ShopLocation {
  id: string;
  mechanicId?: string | null;
  name: string;
  latitude: number;
  longitude: number;
  phone: string;
  image?: string;
  distance?: number;
  providerType: 'registered' | 'unregistered' | string;
  location?: string;
  city?: string;
  region?: string;
  specialization?: string;
  licenseNumber?: string;
  status?: string;
}

const SHOP_STORAGE_VERSION_KEY = 'shopStorageVersion';
const CURRENT_SHOP_STORAGE_VERSION = '3';
const REMOVED_SHOP_NAMES = new Set([
  'elliot auto',
  'elliot autos',
  'elliots auto',
  'elliots autos',
  'fast fix',
  'fast fixes',
]);

const normalizeShopNameForRemoval = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isRemovedShopName = (name: string) => REMOVED_SHOP_NAMES.has(normalizeShopNameForRemoval(name));

const removeUnavailableShops = (shops: ShopLocation[]) =>
  shops.filter((shop) => shop.providerType !== 'tow' && !isRemovedShopName(shop.name));

const removeInactiveShops = (shops: ShopLocation[]) =>
  shops.filter((shop) => String(shop.status || 'active').trim().toLowerCase() !== 'inactive');

export const removeUnavailableShopNames = (shops: ShopLocation[]) =>
  removeInactiveShops(removeUnavailableShops(shops));

/**
 * Removes the legacy sample and previously registered shop data once.
 * Shops registered after this reset remain available to drivers.
 */
export const resetLegacyShopData = async (): Promise<void> => {
  const storedVersion = await AsyncStorage.getItem(SHOP_STORAGE_VERSION_KEY);
  if (storedVersion === CURRENT_SHOP_STORAGE_VERSION) return;

  await AsyncStorage.multiRemove(['registeredShops', 'cachedNearbyShops', 'cachedShopsTimestamp']);
  await AsyncStorage.setItem(SHOP_STORAGE_VERSION_KEY, CURRENT_SHOP_STORAGE_VERSION);
};

/** Removes shops that are no longer available from local registration data. */
export const removeDeletedShops = async (): Promise<void> => {
  const [registeredShopsJson, cachedNearbyShopsJson, mechanicShopsApiCacheJson] = await Promise.all([
    AsyncStorage.getItem('registeredShops'),
    AsyncStorage.getItem('cachedNearbyShops'),
    AsyncStorage.getItem('mechanicShopsApiCache'),
  ]);

  if (registeredShopsJson) {
    const registeredShops = JSON.parse(registeredShopsJson) as ShopLocation[];
    const activeShops = removeUnavailableShops(
      registeredShops.filter((shop) => shop.name.trim().toLowerCase() !== 'ck fixes')
    );

    if (activeShops.length !== registeredShops.length) {
      await AsyncStorage.setItem('registeredShops', JSON.stringify(activeShops));
    }
  }

  if (cachedNearbyShopsJson) {
    const cachedNearbyShops = JSON.parse(cachedNearbyShopsJson) as ShopLocation[];
    const activeCachedShops = removeUnavailableShops(cachedNearbyShops);

    if (activeCachedShops.length !== cachedNearbyShops.length) {
      await AsyncStorage.setItem('cachedNearbyShops', JSON.stringify(activeCachedShops));
    }
  }

  if (mechanicShopsApiCacheJson) {
    const cachedApiShops = JSON.parse(mechanicShopsApiCacheJson) as MechanicShopItem[];
    const activeApiShops = cachedApiShops.filter(
      (shop) => shop.providerType !== 'tow' && !isRemovedShopName(shop.shopName)
    );

    if (activeApiShops.length !== cachedApiShops.length) {
      await AsyncStorage.setItem('mechanicShopsApiCache', JSON.stringify(activeApiShops));
    }
  }
};

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 Starting latitude
 * @param lon1 Starting longitude
 * @param lat2 Destination latitude
 * @param lon2 Destination longitude
 * @returns Distance in kilometers
 */
export const calculateDistance = (
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

/**
 * Fetch nearby shops registered from the mechanic registration page.
 * @param latitude Driver's current latitude
 * @param longitude Driver's current longitude
 * @param maxRadiusKm Maximum radius to search (default: 50km for Ghana-wide search)
 * @returns Array of shops sorted by distance
 */
export const fetchNearbyShops = async (
  latitude: number,
  longitude: number,
  maxRadiusKm: number = Number.POSITIVE_INFINITY,
  options: { forceRefresh?: boolean } = {}
): Promise<ShopLocation[]> => {
  try {
    await removeDeletedShops();

    let loadedFromDatabase = false;
    const databaseShops = await getMechanicShops({ forceRefresh: options.forceRefresh })
      .then((shops) => {
        loadedFromDatabase = true;
        return shops
          .filter((shop) => shop.providerType !== 'tow')
          .map(mapDatabaseShopToLocation);
      })
      .catch((error) => {
        console.warn('Unable to load shops from database, using local cache:', error);
        return [] as ShopLocation[];
      });

    const registeredShopsJson = await AsyncStorage.getItem('registeredShops');
    const localShops: ShopLocation[] = registeredShopsJson
      ? (JSON.parse(registeredShopsJson) as ShopLocation[]).map((shop) => ({
          ...shop,
          providerType: 'registered',
          status: shop.status || 'active',
        }))
      : [];
    const shopMap = new Map<string, ShopLocation>();

    if (!loadedFromDatabase) {
      for (const shop of localShops) {
        shopMap.set(getShopIdentity(shop), shop);
      }
    }

    for (const shop of databaseShops) {
      shopMap.set(getShopIdentity(shop), shop);
    }

    const registeredShops = removeUnavailableShops(Array.from(shopMap.values()));

    if (loadedFromDatabase) {
      await AsyncStorage.setItem('registeredShops', JSON.stringify(registeredShops));
    }

    const shopsWithDistance = removeInactiveShops(registeredShops)
      .map((shop) => ({
        ...shop,
        distance: calculateDistance(latitude, longitude, shop.latitude, shop.longitude),
      }))
      .filter((shop) => (shop.distance || 0) <= maxRadiusKm);

    // Sort by distance (closest first)
    return shopsWithDistance.sort((a, b) => (a.distance || 0) - (b.distance || 0));
  } catch (error) {
    console.error('Error fetching nearby shops:', error);
    // Return empty array on error
    return [];
  }
};

const mapDatabaseShopToLocation = (shop: MechanicShopItem): ShopLocation => ({
  id: shop.shopId,
  mechanicId: shop.mechanicId,
  name: shop.shopName,
  latitude: shop.latitude,
  longitude: shop.longitude,
  phone: shop.phone,
  providerType: shop.providerType || 'registered',
  location: shop.location,
  city: shop.location,
  specialization: shop.specialization,
  licenseNumber: shop.licenseNumber,
  status: shop.status,
});

const getShopIdentity = (shop: ShopLocation) => shop.licenseNumber || shop.id;

/**
 * Get shops within a specific radius from driver's location
 * Useful for map display and filtering
 * @param shops Array of shops with distances
 * @param radiusKm Radius in kilometers
 * @returns Filtered shops within the radius
 */
export const getShopsWithinRadius = (
  shops: ShopLocation[],
  radiusKm: number
): ShopLocation[] => {
  return shops.filter((shop) => (shop.distance || 0) <= radiusKm);
};

/**
 * Get shops by region for better organization
 * @param shops Array of shops
 * @param region Region name
 * @returns Shops filtered by region
 */
export const getShopsByRegion = (
  shops: ShopLocation[],
  region: string
): ShopLocation[] => {
  return shops.filter((shop) => shop.region === region);
};

/**
 * Get shops sorted by distance
 * @param shops Array of shops
 * @returns Shops sorted by distance (closest first)
 */
export const getSortedByDistance = (shops: ShopLocation[]): ShopLocation[] => {
  return [...shops].sort((a, b) => (a.distance || 0) - (b.distance || 0));
};

/**
 * Get shops by provider type (registered or unregistered)
 * @param shops Array of shops
 * @param providerType 'registered' or 'unregistered'
 * @returns Filtered shops
 */
export const getShopsByProviderType = (
  shops: ShopLocation[],
  providerType: 'registered' | 'unregistered'
): ShopLocation[] => {
  return shops.filter((shop) => shop.providerType === providerType);
};

/**
 * Search shops by name
 * @param shops Array of shops
 * @param query Search query
 * @returns Filtered shops matching the search term
 */
export const searchShops = (shops: ShopLocation[], query: string): ShopLocation[] => {
  const lowerQuery = query.toLowerCase();
  return shops.filter(
    (shop) =>
      shop.name.toLowerCase().includes(lowerQuery) ||
      shop.city?.toLowerCase().includes(lowerQuery) ||
      shop.region?.toLowerCase().includes(lowerQuery)
  );
};

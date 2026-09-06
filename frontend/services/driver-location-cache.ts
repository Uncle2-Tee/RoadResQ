import AsyncStorage from '@react-native-async-storage/async-storage';

const DRIVER_LOCATION_CACHE_KEY = 'lastDriverCoordinates';

type CachedDriverLocation = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

export const saveDriverLocation = (latitude: number, longitude: number) =>
  AsyncStorage.setItem(
    DRIVER_LOCATION_CACHE_KEY,
    JSON.stringify({ latitude, longitude, timestamp: Date.now() } satisfies CachedDriverLocation)
  );

export const getCachedDriverLocation = async (maxAgeMs = 15 * 60 * 1000) => {
  const cachedJson = await AsyncStorage.getItem(DRIVER_LOCATION_CACHE_KEY);
  if (!cachedJson) {
    return null;
  }

  try {
    const cached = JSON.parse(cachedJson) as CachedDriverLocation;
    const isValid =
      Number.isFinite(cached.latitude) &&
      Number.isFinite(cached.longitude) &&
      Date.now() - cached.timestamp <= maxAgeMs;
    return isValid ? cached : null;
  } catch {
    return null;
  }
};

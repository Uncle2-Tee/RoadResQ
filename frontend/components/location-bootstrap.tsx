import * as Location from 'expo-location';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { saveDriverLocation } from '../services/driver-location-cache';

const LOCATION_TIMEOUT_MS = 8000;

const getCurrentLocationWithTimeout = async () => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeout,
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export function LocationBootstrap() {
  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    let active = true;

    const warmLocationCache = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        const status = permission.status === 'granted'
          ? permission.status
          : (await Location.requestForegroundPermissionsAsync()).status;

        if (status !== 'granted' || !active) {
          return;
        }

        const cached = await Location.getLastKnownPositionAsync({
          maxAge: 15 * 60 * 1000,
          requiredAccuracy: 5000,
        });
        if (cached && active) {
          await saveDriverLocation(cached.coords.latitude, cached.coords.longitude);
        }

        const current = await getCurrentLocationWithTimeout();
        if (current && active) {
          await saveDriverLocation(current.coords.latitude, current.coords.longitude);
        }
      } catch (error) {
        // Individual map screens can still use their own retry controls.
        console.warn('[location] Startup location warm-up unavailable:', error);
      }
    };

    warmLocationCache();

    return () => {
      active = false;
    };
  }, []);

  return null;
}

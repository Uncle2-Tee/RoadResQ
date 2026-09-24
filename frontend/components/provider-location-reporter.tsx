import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';

import { saveProviderLocationToApi } from '../services/api-client';

export function ProviderLocationReporter() {
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const role = await AsyncStorage.getItem('userRole');
      if (!active || !['mechanic', 'tower'].includes(role || '')) return;

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!active || status !== 'granted') return;

      subscriptionRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        ({ coords }) => {
          saveProviderLocationToApi({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }).catch(() => {});
        }
      );
    })();

    return () => {
      active = false;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, []);

  return null;
}
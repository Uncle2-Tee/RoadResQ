import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

export default function IndexScreen() {
  const [redirectTo, setRedirectTo] = useState<
    '/login' | '/driver-dashboard' | '/mechanic-dashboard' | '/tower-dashboard' | '/admin-dashboard' | null
  >(null);

  useEffect(() => {
    (async () => {
      const [userId, userRole] = await Promise.all([
        AsyncStorage.getItem('userId'),
        AsyncStorage.getItem('userRole'),
      ]);

      if (!userId || !userRole) {
        setRedirectTo('/login');
        return;
      }

      setRedirectTo(
        userRole === 'admin'
          ? '/admin-dashboard'
          : userRole === 'mechanic'
          ? '/mechanic-dashboard'
          : userRole === 'tower'
            ? '/tower-dashboard'
            : '/driver-dashboard'
      );
    })();
  }, []);

  if (!redirectTo) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#FF8C42" />
      </View>
    );
  }

  return <Redirect href={redirectTo} />;
}

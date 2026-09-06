import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { BlinkingRequestNotification } from '../components/blinking-request-notification';
import { DriverRequestStatusWatcher } from '../components/driver-request-status-watcher';
import { MechanicRequestSoundWatcher } from '../components/mechanic-request-sound-watcher';
import { PushNotificationManager } from '../components/push-notification-manager';
import { useColorScheme } from '../hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          animation: 'fade_from_bottom',
          freezeOnBlur: true,
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="driver-dashboard" />
        <Stack.Screen name="mechanic-dashboard" />
        <Stack.Screen name="tower-dashboard" />
        <Stack.Screen name="admin-dashboard" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="map" />
        <Stack.Screen name="mechanic-chat" />
        <Stack.Screen name="mechanic-inbox" />
        <Stack.Screen name="request" />
        <Stack.Screen name="service-notifications" />
        <Stack.Screen name="mechanic-register" />
        <Stack.Screen name="tower-register" />
        <Stack.Screen name="payment" />
        <Stack.Screen name="transaction-history" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="role-select" />
        <Stack.Screen name="explore" />
        <Stack.Screen name="tow-request" />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <BlinkingRequestNotification />
      <DriverRequestStatusWatcher />
      <MechanicRequestSoundWatcher />
      <PushNotificationManager />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

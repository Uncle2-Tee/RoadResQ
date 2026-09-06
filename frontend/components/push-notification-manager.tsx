import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import {
  getExpoNotificationsModule,
  registerCurrentProviderPushToken,
} from '../services/push-notifications';

type NotificationData = {
  screen?: unknown;
};

export function PushNotificationManager() {
  const router = useRouter();
  const handledNotificationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    let isMounted = true;
    let responseSubscription: { remove: () => void } | null = null;

    const registerProviderDevice = () => {
      registerCurrentProviderPushToken().catch((error) => {
        console.warn('[push] Unable to refresh provider push token:', error);
      });
    };

    registerProviderDevice();

    const openNotificationTarget = (data?: NotificationData, notificationId?: string) => {
      if (notificationId && handledNotificationIdRef.current === notificationId) {
        return;
      }

      const screen = typeof data?.screen === 'string' ? data.screen : '';
      if (screen !== 'request' && screen !== 'mechanic-inbox') {
        return;
      }

      handledNotificationIdRef.current = notificationId || null;
      router.push(screen === 'request' ? '/request' : '/mechanic-inbox');
    };

    getExpoNotificationsModule()
      .then((Notifications) => {
        if (!isMounted || !Notifications) {
          return;
        }

        responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
          openNotificationTarget(
            response.notification.request.content.data as NotificationData,
            response.notification.request.identifier
          );
        });

        Notifications.getLastNotificationResponseAsync()
          .then((response) => {
            if (!response) {
              return;
            }

            openNotificationTarget(
              response.notification.request.content.data as NotificationData,
              response.notification.request.identifier
            );
          })
          .catch(() => {});
      })
      .catch(() => {});

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        registerProviderDevice();
      }
    });

    return () => {
      isMounted = false;
      responseSubscription?.remove();
      appStateSubscription.remove();
    };
  }, [router]);

  return null;
}

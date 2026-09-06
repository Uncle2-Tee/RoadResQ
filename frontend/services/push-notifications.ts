import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerPushToken, unregisterPushToken } from './api-client';

const PUSH_TOKEN_KEY = 'providerPushToken';
const PUSH_TOKEN_USER_ID_KEY = 'providerPushTokenUserId';
const PUSH_TOKEN_ROLE_KEY = 'providerPushTokenRole';
const USER_ID_KEY = 'userId';
const USER_ROLE_KEY = 'userRole';
const REQUEST_NOTIFICATION_CHANNEL_ID = 'requests';

type ProviderRole = 'mechanic' | 'tower';
export type ExpoNotificationsModule = typeof import('expo-notifications');

let notificationsModulePromise: Promise<ExpoNotificationsModule | null> | null = null;
let notificationHandlerConfigured = false;
let unavailableWarningShown = false;

const isProviderRole = (role?: string | null): role is ProviderRole =>
  role === 'mechanic' || role === 'tower';

export const isExpoGoRuntime = () => {
  const constants = Constants as typeof Constants & {
    appOwnership?: string | null;
    executionEnvironment?: string;
    expoGoConfig?: unknown | null;
  };

  return (
    constants.appOwnership === 'expo' ||
    constants.executionEnvironment === 'storeClient' ||
    Boolean(constants.expoGoConfig)
  );
};

export const canUseRemotePushNotifications = () =>
  Platform.OS !== 'web' && !isExpoGoRuntime();

const warnPushUnavailableOnce = () => {
  if (unavailableWarningShown || !__DEV__) {
    return;
  }

  unavailableWarningShown = true;
  console.warn(
    '[push] Remote push notifications are disabled in Expo Go. Use an Expo development build or production build to receive request alerts outside the app.'
  );
};

export async function getExpoNotificationsModule() {
  if (!canUseRemotePushNotifications()) {
    warnPushUnavailableOnce();
    return null;
  }

  notificationsModulePromise ||= import('expo-notifications')
    .then((Notifications) => {
      if (!notificationHandlerConfigured) {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
          }),
        });
        notificationHandlerConfigured = true;
      }

      return Notifications;
    })
    .catch((error) => {
      console.warn('[push] Unable to load expo-notifications:', error);
      return null;
    });

  return notificationsModulePromise;
}

const getExpoProjectId = () => {
  const constants = Constants as typeof Constants & {
    easConfig?: { projectId?: string };
    expoConfig?: {
      extra?: {
        eas?: {
          projectId?: string;
        };
      };
    };
  };

  return (
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    constants.easConfig?.projectId ||
    constants.expoConfig?.extra?.eas?.projectId ||
    null
  );
};

async function ensureNotificationChannel(Notifications: ExpoNotificationsModule) {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(REQUEST_NOTIFICATION_CHANNEL_ID, {
    name: 'Request alerts',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF7A1A',
  });
}

const allowsNotifications = (
  permission: Awaited<ReturnType<ExpoNotificationsModule['getPermissionsAsync']>>,
  Notifications: ExpoNotificationsModule
) => {
  const permissionState = permission as Awaited<ReturnType<ExpoNotificationsModule['getPermissionsAsync']>> & {
    granted?: boolean;
    status?: string;
  };

  return (
    permissionState.granted === true ||
    permissionState.status === 'granted' ||
    permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
};

async function requestNotificationPermission(Notifications: ExpoNotificationsModule) {
  const currentPermission = await Notifications.getPermissionsAsync();
  if (allowsNotifications(currentPermission, Notifications)) {
    return true;
  }

  const requestedPermission = await Notifications.requestPermissionsAsync();
  return allowsNotifications(requestedPermission, Notifications);
}

export async function registerProviderPushTokenIfNeeded(userId: string, role: string) {
  if (Platform.OS === 'web' || !userId || !isProviderRole(role)) {
    return null;
  }

  try {
    const Notifications = await getExpoNotificationsModule();
    if (!Notifications) {
      return null;
    }

    await ensureNotificationChannel(Notifications);

    const hasPermission = await requestNotificationPermission(Notifications);
    if (!hasPermission) {
      console.warn('[push] Request notification permission was not granted.');
      return null;
    }

    const projectId = getExpoProjectId();
    if (!projectId) {
      console.warn(
        '[push] Missing Expo project ID. Set EXPO_PUBLIC_EAS_PROJECT_ID or add extra.eas.projectId in app.json.'
      );
      return null;
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResponse.data;
    if (!token) {
      return null;
    }

    await registerPushToken({
      userId,
      token,
      role,
      platform: Platform.OS,
    });

    await AsyncStorage.multiSet([
      [PUSH_TOKEN_KEY, token],
      [PUSH_TOKEN_USER_ID_KEY, userId],
      [PUSH_TOKEN_ROLE_KEY, role],
    ]);

    return token;
  } catch (error) {
    console.warn('[push] Unable to register provider push token:', error);
    return null;
  }
}

export async function registerCurrentProviderPushToken() {
  const [userId, role] = await Promise.all([
    AsyncStorage.getItem(USER_ID_KEY),
    AsyncStorage.getItem(USER_ROLE_KEY),
  ]);

  if (!userId || !isProviderRole(role)) {
    return null;
  }

  return registerProviderPushTokenIfNeeded(userId, role);
}

export async function unregisterCurrentProviderPushToken(userIdOverride?: string | null) {
  const [token, tokenUserId] = await Promise.all([
    AsyncStorage.getItem(PUSH_TOKEN_KEY),
    AsyncStorage.getItem(PUSH_TOKEN_USER_ID_KEY),
  ]);
  const userId = userIdOverride || tokenUserId;

  await AsyncStorage.multiRemove([PUSH_TOKEN_KEY, PUSH_TOKEN_USER_ID_KEY, PUSH_TOKEN_ROLE_KEY]);

  if (!token || !userId) {
    return;
  }

  await unregisterPushToken({ userId, token });
}

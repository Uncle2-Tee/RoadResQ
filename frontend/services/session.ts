import AsyncStorage from '@react-native-async-storage/async-storage';
import { logout } from './api-client';
import { unregisterCurrentProviderPushToken } from './push-notifications';

const SESSION_STORAGE_KEYS = [
  'driverName',
  'driverPhone',
  'mechanicName',
  'towerName',
  'userId',
  'userSessionId',
  'userRole',
  'currentUserEmail',
];

const LAST_AUTHENTICATED_ROLE_KEY = 'lastAuthenticatedRole';
const LAST_MECHANIC_ID_KEY = 'lastAuthenticatedMechanicId';
const LAST_MECHANIC_NAME_KEY = 'lastAuthenticatedMechanicName';

export async function logoutImmediately(navigateToLogin: () => void) {
  const [userIdResult, sessionIdResult, userRoleResult, mechanicNameResult] = await Promise.allSettled([
    AsyncStorage.getItem('userId'),
    AsyncStorage.getItem('userSessionId'),
    AsyncStorage.getItem('userRole'),
    AsyncStorage.getItem('mechanicName'),
  ]);
  const userId = userIdResult.status === 'fulfilled' ? userIdResult.value : null;
  const sessionId = sessionIdResult.status === 'fulfilled' ? sessionIdResult.value : null;
  const userRole = userRoleResult.status === 'fulfilled' ? userRoleResult.value : null;
  const mechanicName = mechanicNameResult.status === 'fulfilled' ? mechanicNameResult.value : null;

  await AsyncStorage.multiRemove(SESSION_STORAGE_KEYS).catch((error) => {
    console.error('Unable to clear local session during logout:', error);
  });

  if (userRole === 'mechanic' || userRole === 'driver' || userRole === 'tower') {
    await AsyncStorage.setItem(LAST_AUTHENTICATED_ROLE_KEY, userRole).catch(() => {});
  }

  if (userRole === 'mechanic' && userId) {
    const lastMechanicItems: [string, string][] = [[LAST_MECHANIC_ID_KEY, userId]];
    if (mechanicName) {
      lastMechanicItems.push([LAST_MECHANIC_NAME_KEY, mechanicName]);
    }
    await AsyncStorage.multiSet(lastMechanicItems).catch(() => {});
  }

  navigateToLogin();

  if (userId && (userRole === 'mechanic' || userRole === 'tower')) {
    unregisterCurrentProviderPushToken(userId).catch((error) => {
      console.warn('Unable to remove push notification device after logout:', error);
    });
  }

  if (userId && sessionId) {
    logout(userId, sessionId).catch((error) => {
      console.warn('Remote logout failed after local sign out:', error);
    });
  }
}

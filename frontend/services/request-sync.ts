import AsyncStorage from '@react-native-async-storage/async-storage';

export const DRIVER_HIDDEN_REQUEST_IDS_KEY = 'driverHiddenRequestIds';
export const MECHANIC_HIDDEN_REQUEST_IDS_KEY = 'mechanicHiddenRequestIds';
export const REQUEST_OVERVIEW_UPDATED_AT_KEY = 'requestOverviewUpdatedAt';

const requestOverviewListeners = new Set<() => void>();

export function subscribeToRequestOverviewChanges(listener: () => void) {
  requestOverviewListeners.add(listener);
  return () => {
    requestOverviewListeners.delete(listener);
  };
}

export const inactiveRequestStatuses = new Set(['cancelled', 'canceled']);

export async function getHiddenRequestIds(): Promise<Set<string>> {
  const [driverHiddenJson, mechanicHiddenJson] = await Promise.all([
    AsyncStorage.getItem(DRIVER_HIDDEN_REQUEST_IDS_KEY),
    AsyncStorage.getItem(MECHANIC_HIDDEN_REQUEST_IDS_KEY),
  ]);

  const driverHidden: string[] = driverHiddenJson ? JSON.parse(driverHiddenJson) : [];
  const mechanicHidden: string[] = mechanicHiddenJson ? JSON.parse(mechanicHiddenJson) : [];

  return new Set([...driverHidden, ...mechanicHidden]);
}

export async function addHiddenRequestId(storageKey: string, requestId: string) {
  const hiddenRequestIdsJson = await AsyncStorage.getItem(storageKey);
  const hiddenRequestIds: string[] = hiddenRequestIdsJson
    ? JSON.parse(hiddenRequestIdsJson)
    : [];
  const updatedHiddenRequestIds = Array.from(new Set([...hiddenRequestIds, requestId]));

  await AsyncStorage.multiSet([
    [storageKey, JSON.stringify(updatedHiddenRequestIds)],
    [REQUEST_OVERVIEW_UPDATED_AT_KEY, Date.now().toString()],
  ]);
  requestOverviewListeners.forEach((listener) => listener());

  return updatedHiddenRequestIds;
}

export async function touchRequestOverview() {
  await AsyncStorage.setItem(REQUEST_OVERVIEW_UPDATED_AT_KEY, Date.now().toString());
  requestOverviewListeners.forEach((listener) => listener());
}

export function isRequestVisible(requestId: string, status: string | undefined, hiddenIds: Set<string>) {
  return !hiddenIds.has(requestId) && !inactiveRequestStatuses.has((status || '').toLowerCase());
}

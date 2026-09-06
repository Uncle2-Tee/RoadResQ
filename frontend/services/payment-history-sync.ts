import AsyncStorage from '@react-native-async-storage/async-storage';

export const DELETED_PAYMENT_IDS_KEY = 'deletedPaymentIds';
export const PAYMENT_HISTORY_UPDATED_AT_KEY = 'paymentHistoryUpdatedAt';

type PaymentHistoryListener = () => void;

const listeners = new Set<PaymentHistoryListener>();

export const notifyPaymentHistoryChanged = () => {
  listeners.forEach((listener) => listener());
};

export const subscribeToPaymentHistoryChanges = (listener: PaymentHistoryListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const markPaymentHistoryChanged = async (paymentIds: string[]) => {
  const deletedIdsJson = await AsyncStorage.getItem(DELETED_PAYMENT_IDS_KEY);
  const deletedIds = new Set<string>(deletedIdsJson ? JSON.parse(deletedIdsJson) : []);
  paymentIds.filter(Boolean).forEach((paymentId) => deletedIds.add(paymentId));

  await AsyncStorage.setItem(DELETED_PAYMENT_IDS_KEY, JSON.stringify(Array.from(deletedIds)));
  await AsyncStorage.setItem(PAYMENT_HISTORY_UPDATED_AT_KEY, new Date().toISOString());
  notifyPaymentHistoryChanged();
};

export const getDeletedPaymentIds = async () => {
  const deletedIdsJson = await AsyncStorage.getItem(DELETED_PAYMENT_IDS_KEY);
  return new Set<string>(deletedIdsJson ? JSON.parse(deletedIdsJson) : []);
};

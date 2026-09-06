import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Image, Platform, StyleSheet, View } from 'react-native';
import { AppIcon, AppIconName } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { getMechanicShops, getPaymentRecords, type PaymentRecordItem } from '../services/api-client';
import { getDeletedPaymentIds, markPaymentHistoryChanged } from '../services/payment-history-sync';

interface PaymentRecord {
  id: string;
  paymentId?: string;
  reference?: string | null;
  method: 'mtn' | 'telecel' | 'airtel' | 'paystack' | 'card' | 'mobile_money';
  phoneNumber?: string | null;
  amount: number;
  currency: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  driverName: string;
  mechanicId?: string | null;
  mechanicName?: string | null;
  providerName?: string | null;
  requestId?: string | null;
  provider?: string | null;
  paidAt?: string | null;
}

const PAYMENT_RECORDS_KEY = 'paymentRecords';
const USER_ID_KEY = 'userId';
const DRIVER_NAME_KEY = 'driverName';
const MECHANIC_NAME_KEY = 'mechanicName';
const TOWER_NAME_KEY = 'towerName';
const IS_IOS = Platform.OS === 'ios';

type FilterStatus = 'all' | 'completed' | 'processing' | 'failed' | 'cancelled';

const mapApiPaymentRecord = (payment: PaymentRecordItem): PaymentRecord => ({
  id: payment.paymentId || payment.id,
  paymentId: payment.paymentId,
  reference: payment.reference,
  method: payment.method,
  phoneNumber: payment.phoneNumber,
  amount: payment.amount,
  currency: payment.currency,
  status: payment.status,
  createdAt: payment.paidAt || payment.createdAt,
  driverName: payment.driverName,
  mechanicId: payment.mechanicId,
  mechanicName: payment.mechanicName,
  providerName: payment.providerName,
  requestId: payment.requestId,
  provider: payment.provider,
  paidAt: payment.paidAt,
});

const normalizeLocalPaymentRecord = (payment: PaymentRecord): PaymentRecord => ({
  ...payment,
  id: payment.paymentId || payment.id,
  paymentId: payment.paymentId || payment.id,
  method: payment.method || 'paystack',
  currency: payment.currency || 'GHS',
  status: payment.status || 'processing',
});

export default function TransactionHistoryScreen() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<PaymentRecord[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<PaymentRecord[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<'mechanic' | 'driver' | 'tower' | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const handleHomePress = () => {
    if (userRole === 'mechanic') {
      router.push('/mechanic-dashboard');
    } else if (userRole === 'tower') {
      router.push('/tower-dashboard');
    } else if (userRole === 'driver') {
      router.push('/payment');
    }
  };

  const loadUserRole = useCallback(async () => {
    try {
      const role = await AsyncStorage.getItem('userRole');
      setUserRole((role as 'mechanic' | 'driver' | 'tower') || 'driver');
    } catch (error) {
      console.error('Error loading user role:', error);
      setUserRole('driver');
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      if (!hasLoadedOnceRef.current) {
        setLoading(true);
      }
      const [roleValue, userId, driverNameValue, mechanicNameValue, towerNameValue, data] = await Promise.all([
        AsyncStorage.getItem('userRole'),
        AsyncStorage.getItem(USER_ID_KEY),
        AsyncStorage.getItem(DRIVER_NAME_KEY),
        AsyncStorage.getItem(MECHANIC_NAME_KEY),
        AsyncStorage.getItem(TOWER_NAME_KEY),
        AsyncStorage.getItem(PAYMENT_RECORDS_KEY),
      ]);
      const role = (roleValue as 'mechanic' | 'driver' | 'tower') || 'driver';
      const deletedPaymentIds = await getDeletedPaymentIds();
      const localRecords: PaymentRecord[] = data
        ? (JSON.parse(data) as PaymentRecord[]).map(normalizeLocalPaymentRecord)
        : [];
      const visibleLocalRecords = localRecords.filter((record) => !deletedPaymentIds.has(record.paymentId || record.id));
      const localSorted = [...visibleLocalRecords].sort((a: PaymentRecord, b: PaymentRecord) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setTransactions(localSorted);
      filterTransactions(localSorted, filterStatus);
      setLoading(false);

      let apiRecords: PaymentRecord[] = [];

      if (role === 'mechanic' || role === 'tower') {
        const providerNameValue = role === 'tower' ? towerNameValue : mechanicNameValue;
        const providerNames = new Set<string>();
        if (providerNameValue?.trim()) {
          providerNames.add(providerNameValue.trim());
        }

        const shops = await getMechanicShops().catch(() => []);
        shops
          .filter((shop) =>
            (role === 'mechanic' ? shop.providerType !== 'tow' : shop.providerType === 'tow') &&
            (userId
              ? shop.mechanicId === userId
              : providerNameValue
                ? shop.shopName.trim().toLowerCase() === providerNameValue.trim().toLowerCase()
                : false)
          )
          .forEach((shop) => providerNames.add(shop.shopName));

        apiRecords = await getPaymentRecords({
          mechanicId: userId,
          providerNames: Array.from(providerNames),
          forceRefresh: false,
        })
          .then((payments) => payments.map(mapApiPaymentRecord))
          .catch(() => []);
      } else {
        const driverName = driverNameValue || 'Driver';
        apiRecords = await getPaymentRecords({
          driverId: userId,
          driverName,
          forceRefresh: false,
        })
          .then((payments) => payments.map(mapApiPaymentRecord))
          .catch(() => []);
      }

          apiRecords = apiRecords.filter((record) => !deletedPaymentIds.has(record.paymentId || record.id));

      const transactionMap = new Map<string, PaymentRecord>();
          visibleLocalRecords.forEach((record) => transactionMap.set(record.paymentId || record.id, record));
      apiRecords.forEach((record) => transactionMap.set(record.paymentId || record.id, record));

      const sorted = Array.from(transactionMap.values()).sort((a: PaymentRecord, b: PaymentRecord) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setTransactions(sorted);
      filterTransactions(sorted, filterStatus);
    } catch (error) {
      console.error('Error loading transactions:', error);
      Alert.alert('Error', 'Failed to load transaction history');
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [filterStatus]);

  const filterTransactions = (records: PaymentRecord[], status: FilterStatus) => {
    if (status === 'all') {
      setFilteredTransactions(records);
    } else {
      setFilteredTransactions(records.filter((t) => t.status === status));
    }
  };

  const handleFilterChange = (status: FilterStatus) => {
    setFilterStatus(status);
    filterTransactions(transactions, status);
  };

  const handleDeleteTransaction = (transactionId: string) => {
    Alert.alert(
      'Delete Transaction',
      'Are you sure you want to delete this transaction record?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const updated = transactions.filter((t) => t.id !== transactionId);
              const record = transactions.find((transaction) => transaction.id === transactionId);
              const paymentId = record?.paymentId || record?.id;
              await AsyncStorage.setItem(PAYMENT_RECORDS_KEY, JSON.stringify(updated));
              await markPaymentHistoryChanged(paymentId ? [paymentId] : []);
              setTransactions(updated);
              filterTransactions(updated, filterStatus);
              Alert.alert('Success', 'Transaction deleted');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete transaction');
            }
          },
        },
      ]
    );
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear All Transactions',
      'Are you sure you want to delete all transaction records? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.setItem(PAYMENT_RECORDS_KEY, JSON.stringify([]));
              const paymentIds = transactions.map((transaction) => transaction.paymentId || transaction.id);
              await markPaymentHistoryChanged(paymentIds);
              setTransactions([]);
              setFilteredTransactions([]);
              Alert.alert('Success', 'All transactions cleared');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear transactions');
            }
          },
        },
      ]
    );
  };

  useFocusEffect(
    useCallback(() => {
      loadUserRole();
      loadTransactions();
    }, [loadTransactions, loadUserRole])
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#28a745';
      case 'processing':
        return '#FF8C42';
      case 'failed':
        return '#dc3545';
      default:
        return '#666';
    }
  };

  const getStatusIcon = (status: string): AppIconName => {
    switch (status) {
      case 'completed':
        return 'check';
      case 'processing':
        return 'timer';
      case 'failed':
        return 'close';
      default:
        return 'alert';
    }
  };

  const getMethodIcon = (method: string): AppIconName => {
    switch (method) {
      case 'mtn':
        return 'smartphone';
      case 'telecel':
        return 'creditCard';
      case 'airtel':
        return 'smartphone';
      case 'paystack':
        return 'creditCard';
      case 'card':
        return 'creditCard';
      case 'mobile_money':
        return 'smartphone';
      default:
        return 'wallet';
    }
  };

  const getMethodLogo = (method: string) => {
    switch (method) {
      case 'mtn':
        return require('../assets/images/mtn-logo.png');
      case 'telecel':
        return require('../assets/images/telecel-logo.png');
      case 'airtel':
        return require('../assets/images/airtel-logo.png');
      default:
        return null;
    }
  };

  const getMethodName = (method: string) => {
    switch (method) {
      case 'mtn':
        return 'MTN MoMo';
      case 'telecel':
        return 'Telecel Cash';
      case 'airtel':
        return 'AirtelTigo Money';
      case 'paystack':
        return 'Paystack';
      case 'card':
        return 'Card Payment';
      case 'mobile_money':
        return 'Mobile Money';
      default:
        return 'Unknown';
    }
  };

  const getTotalAmount = () => {
    return transactions
      .filter((t) => t.status === 'completed')
      .reduce((sum, t) => sum + t.amount, 0);
  };

  const renderTransactionCard = ({ item }: { item: PaymentRecord }) => (
    <View
      style={styles.transactionCard}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={styles.methodIcon}>
            {getMethodLogo(item.method) ? (
              <Image
                source={getMethodLogo(item.method)}
                style={styles.methodLogo}
                resizeMode="contain"
              />
            ) : (
              <AppIcon name={getMethodIcon(item.method)} size={24} color="#FF8C42" />
            )}
          </View>
          <View>
            <ThemedText style={styles.driverName}>Driver: {item.driverName}</ThemedText>
            <ThemedText style={styles.methodName}>{getMethodName(item.method)}</ThemedText>
          </View>
        </View>
        <View
          style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}
        >
          <AppIcon name={getStatusIcon(item.status)} size={12} color={getStatusColor(item.status)} />
          <ThemedText style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
          </ThemedText>
        </View>
        <TouchableOpacity
          style={styles.deleteTransactionButton}
          onPress={() => handleDeleteTransaction(item.id)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Delete transaction"
        >
          <AppIcon name="trash" size={15} color="#dc3545" />
        </TouchableOpacity>
      </View>

      <View style={styles.cardDetails}>
        <View style={styles.detailRow}>
          <ThemedText style={styles.detailLabel}>Amount:</ThemedText>
          <ThemedText style={styles.detailValue}>{item.currency} {item.amount.toFixed(2)}</ThemedText>
        </View>
        {(item.providerName || item.mechanicName) && (
          <View style={styles.detailRow}>
            <ThemedText style={styles.detailLabel}>Mechanic:</ThemedText>
            <ThemedText style={styles.detailValue}>{item.providerName || item.mechanicName}</ThemedText>
          </View>
        )}
        {item.requestId && (
          <View style={styles.detailRow}>
            <ThemedText style={styles.detailLabel}>Request ID:</ThemedText>
            <ThemedText style={styles.detailValue}>{item.requestId}</ThemedText>
          </View>
        )}
        <View style={styles.detailRow}>
          <ThemedText style={styles.detailLabel}>Phone:</ThemedText>
          <ThemedText style={styles.detailValue}>{item.phoneNumber || 'Not provided'}</ThemedText>
        </View>
        <View style={styles.detailRow}>
          <ThemedText style={styles.detailLabel}>Date:</ThemedText>
          <ThemedText style={styles.detailValue}>
            {new Date(item.createdAt).toLocaleDateString()}
          </ThemedText>
        </View>
        <View style={styles.detailRow}>
          <ThemedText style={styles.detailLabel}>Time:</ThemedText>
          <ThemedText style={styles.detailValue}>
            {new Date(item.createdAt).toLocaleTimeString()}
          </ThemedText>
        </View>
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headingSection}>
        <ThemedText style={styles.pageHeading}>Transaction History</ThemedText>
        <ThemedText style={styles.headingSubtitle}>View all your payment records</ThemedText>
      </View>

      {transactions.length > 0 && (
        <>
          <View style={styles.summarySection}>
            <View style={styles.summaryCard}>
              <ThemedText style={styles.summaryLabel}>Total Completed</ThemedText>
              <ThemedText style={styles.summaryAmount}>
                GHS {getTotalAmount().toFixed(2)}
              </ThemedText>
              <ThemedText style={styles.summarySubtext}>
                {transactions.filter((t) => t.status === 'completed').length} transactions
              </ThemedText>
            </View>
          </View>

          <View style={styles.filterSection}>
            <ScrollableFilterButtons
              currentFilter={filterStatus}
              onFilterChange={handleFilterChange}
            />
          </View>
        </>
      )}

      {loading ? (
        <View style={styles.centerContainer}>
          <ThemedText style={styles.loadingText}>Loading transactions...</ThemedText>
        </View>
      ) : filteredTransactions.length === 0 ? (
        <View style={styles.centerContainer}>
          <AppIcon name="inbox" size={48} color="#999" style={styles.emptyIcon} />
          <ThemedText style={styles.emptyText}>
            {transactions.length === 0 ? 'No transactions yet' : 'No transactions match this filter'}
          </ThemedText>
          <ThemedText style={styles.emptySubtext}>
            {transactions.length === 0
              ? 'Your payment history will appear here'
              : 'Try selecting a different status'}
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={filteredTransactions}
          renderItem={renderTransactionCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {transactions.length > 0 && (
        <View style={styles.actionButtonContainer}>
          <TouchableOpacity
            style={styles.clearButton}
            onPress={handleClearAll}
          >
            <View style={styles.clearButtonContent}>
              <AppIcon name="trash" size={16} color="#dc3545" />
              <ThemedText style={styles.clearButtonText}>Clear All History</ThemedText>
            </View>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.homeButtonContainer}>
        <TouchableOpacity 
          style={styles.homeButton}
          onPress={handleHomePress}
        >
          <View style={styles.homeButtonContent}>
            <AppIcon name="home" size={24} color="#FF8C42" style={styles.homeButtonIcon} />
            <ThemedText style={styles.homeButtonLabel}>Home</ThemedText>
          </View>
        </TouchableOpacity>
      </View>

      <BottomNav showHome={false} />
    </ThemedView>
  );
}

function ScrollableFilterButtons({
  currentFilter,
  onFilterChange,
}: {
  currentFilter: FilterStatus;
  onFilterChange: (filter: FilterStatus) => void;
}) {
  const filters: { label: string; value: FilterStatus }[] = [
    { label: 'All', value: 'all' },
    { label: 'Completed', value: 'completed' },
    { label: 'Processing', value: 'processing' },
    { label: 'Failed', value: 'failed' },
    { label: 'Cancelled', value: 'cancelled' },
  ];

  return (
    <View style={styles.filterButtons}>
      {filters.map((filter) => (
        <TouchableOpacity
          key={filter.value}
          style={[
            styles.filterButton,
            currentFilter === filter.value && styles.filterButtonActive,
          ]}
          onPress={() => onFilterChange(filter.value)}
        >
          <ThemedText
            style={[
              styles.filterButtonText,
              currentFilter === filter.value && styles.filterButtonTextActive,
            ]}
          >
            {filter.label}
          </ThemedText>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  headingSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: IS_IOS ? 28 : 24,
    paddingHorizontal: 16,
    marginBottom: 16,
    marginTop: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 2,
    borderBottomColor: '#FF8C42',
  },
  pageHeading: {
    fontSize: IS_IOS ? 30 : 28,
    fontWeight: '800',
    color: '#333',
    textAlign: 'center',
    marginBottom: 4,
  },
  headingSubtitle: {
    fontSize: IS_IOS ? 15 : 14,
    color: '#666',
    textAlign: 'center',
    fontWeight: '500',
  },
  headerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    paddingTop: 40,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTextWrap: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#666',
  },
  homeButtonContainer: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  homeButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeButtonContent: {
    alignItems: 'center',
  },
  homeButtonIcon: {
    fontSize: 24,
    marginBottom: 4,
    color: '#FF8C42',
  },
  homeButtonLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FF8C42',
  },
  summarySection: {
    padding: IS_IOS ? 18 : 16,
    paddingBottom: 8,
    marginTop: 16,
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: IS_IOS ? 18 : 16,
    borderWidth: 1,
    borderColor: '#eee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  summaryLabel: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#999',
    marginBottom: 6,
    fontWeight: '600',
  },
  summaryAmount: {
    fontSize: IS_IOS ? 30 : 28,
    fontWeight: '700',
    color: '#FF8C42',
    marginBottom: 4,
  },
  summarySubtext: {
    fontSize: IS_IOS ? 14 : 13,
    color: '#666',
  },
  filterSection: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  filterButtons: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4,
  },
  filterButton: {
    paddingHorizontal: IS_IOS ? 16 : 14,
    paddingVertical: IS_IOS ? 10 : 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  filterButtonActive: {
    backgroundColor: '#FF8C42',
    borderColor: '#FF8C42',
  },
  filterButtonText: {
    fontSize: IS_IOS ? 13 : 12,
    fontWeight: '600',
    color: '#666',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  listContent: {
    paddingHorizontal: IS_IOS ? 18 : 16,
    paddingTop: 0,
    paddingBottom: 100,
  },
  transactionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: IS_IOS ? 16 : 14,
    marginBottom: IS_IOS ? 14 : 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  deleteTransactionButton: {
    width: IS_IOS ? 40 : 34,
    height: IS_IOS ? 40 : 34,
    borderRadius: IS_IOS ? 20 : 17,
    backgroundColor: '#FDECEC',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#F7C8C8',
  },
  cardHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  methodIcon: {
    width: IS_IOS ? 56 : 50,
    height: IS_IOS ? 56 : 50,
    borderRadius: 10,
    backgroundColor: '#fff3e0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  iconText: {
    fontSize: 24,
  },
  methodLogo: {
    width: '100%',
    height: '100%',
  },
  driverName: {
    fontSize: IS_IOS ? 16 : 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  methodName: {
    fontSize: IS_IOS ? 14 : 13,
    fontWeight: '600',
    color: '#666',
  },
  cardDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: IS_IOS ? 13 : 12,
    fontWeight: '600',
    color: '#666',
  },
  detailValue: {
    fontSize: IS_IOS ? 13 : 12,
    fontWeight: '600',
    color: '#333',
    textAlign: 'right',
    flex: 1,
    marginLeft: 10,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: IS_IOS ? 12 : 10,
    paddingVertical: IS_IOS ? 7 : 6,
    borderRadius: 12,
    gap: 4,
  },
  statusIcon: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  statusText: {
    fontSize: IS_IOS ? 12 : 11,
    fontWeight: '600',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  actionButtonContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 80,
  },
  clearButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: IS_IOS ? 14 : 12,
    borderWidth: 2,
    borderColor: '#dc3545',
    alignItems: 'center',
  },
  clearButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  clearButtonText: {
    color: '#dc3545',
    fontSize: IS_IOS ? 16 : 15,
    fontWeight: '600',
  },
});


import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, TextInput, View, Image } from 'react-native';
import { AppIcon } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { getMechanicShops, getPaymentRecords, getRequestHistory, updateMechanicShop, updateMechanicShopStatus, type MechanicShopItem, type RequestHistoryItem } from '../services/api-client';
import { getHiddenRequestIds, isRequestVisible, REQUEST_OVERVIEW_UPDATED_AT_KEY, subscribeToRequestOverviewChanges } from '../services/request-sync';
import { logoutImmediately } from '../services/session';
import { getDeletedPaymentIds, subscribeToPaymentHistoryChanges } from '../services/payment-history-sync';

const MECHANIC_NAME_KEY = 'mechanicName';
const USER_ID_KEY = 'userId';
const SERVICE_REQUESTS_STORAGE_KEY = 'serviceRequests';
const PENDING_MECHANIC_SHOP_KEY = 'pendingMechanicShopId';
const IS_IOS = Platform.OS === 'ios';

export default function MechanicDashboardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [mechanicName, setMechanicName] = useState('Mechanic');
  const [totalRequests, setTotalRequests] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [totalTransactions, setTotalTransactions] = useState(0);
  const [totalAmountReceived, setTotalAmountReceived] = useState(0);
  const [mechanicShops, setMechanicShops] = useState<MechanicShopItem[]>([]);
  const [shopsModalOpen, setShopsModalOpen] = useState(false);
  const [updatingShopId, setUpdatingShopId] = useState<string | null>(null);
  const [editingShop, setEditingShop] = useState<MechanicShopItem | null>(null);
  const [editedShopName, setEditedShopName] = useState('');
  const [savingShopName, setSavingShopName] = useState(false);
  const lastOverviewUpdateRef = useRef<string | null>(null);

  const loadDashboardData = useCallback(async () => {
    try {
      let resolvedMechanicName = 'Mechanic';

      // Get mechanic name from route params first, then from storage
      const paramName = typeof params.mechanicName === 'string' ? params.mechanicName : '';
      if (paramName.trim()) {
        resolvedMechanicName = paramName.trim();
        setMechanicName(resolvedMechanicName);
        // Save it to storage if not already saved
        const savedName = await AsyncStorage.getItem(MECHANIC_NAME_KEY);
        if (!savedName) {
          await AsyncStorage.setItem(MECHANIC_NAME_KEY, resolvedMechanicName);
        }
      } else {
        const name = await AsyncStorage.getItem(MECHANIC_NAME_KEY);
        if (name) {
          resolvedMechanicName = name.trim();
          setMechanicName(resolvedMechanicName);
        }
      }

      const savedUserId = await AsyncStorage.getItem(USER_ID_KEY);
      const hiddenRequestIds = await getHiddenRequestIds();
      const providerNames = new Set<string>();
      if (resolvedMechanicName && resolvedMechanicName !== 'Mechanic') {
        providerNames.add(resolvedMechanicName);
      }

      try {
        const shops = await getMechanicShops({ forceRefresh: true, includeInactive: true });
        const ownShops = shops.filter((shop) =>
          shop.providerType !== 'tow' &&
          (savedUserId
            ? shop.mechanicId === savedUserId
            : shop.shopName.trim().toLowerCase() === resolvedMechanicName.toLowerCase())
        );

        setMechanicShops(ownShops);
        const pendingShopId = await AsyncStorage.getItem(PENDING_MECHANIC_SHOP_KEY);
        const approvedPendingShop = ownShops.find((shop) => shop.shopId === pendingShopId && shop.approvalStatus === 'approved');
        if (approvedPendingShop) {
          await AsyncStorage.removeItem(PENDING_MECHANIC_SHOP_KEY);
          Alert.alert('Registration Approved', `${approvedPendingShop.shopName} has been approved and is now registered.`);
        }
        ownShops.forEach((shop) => providerNames.add(shop.shopName));
      } catch (shopError) {
        console.error('Error loading mechanic shops for dashboard stats:', shopError);
        setMechanicShops([]);
      }

      let loadedRequestsFromDatabase = false;
      const databaseRequests = await getRequestHistory({
        mechanicId: savedUserId,
        providerNames: Array.from(providerNames),
        forceRefresh: true,
      })
        .then((requests) => {
          loadedRequestsFromDatabase = true;
          return requests;
        })
        .catch(() => []);
      const localRequestsJson = await AsyncStorage.getItem(SERVICE_REQUESTS_STORAGE_KEY);
      const localRequests: {
        id: string;
        mechanicId: string;
        mechanicName: string;
        driverName: string;
        status: RequestHistoryItem['status'];
        createdAt: string;
        updatedAt: string;
      }[] = localRequestsJson ? JSON.parse(localRequestsJson) : [];

      const requestMap = new Map<string, RequestHistoryItem>();
      databaseRequests
        .filter((request) => request.type !== 'call')
        .filter((request) => isRequestVisible(request.requestId, request.status, hiddenRequestIds))
        .forEach((request) => {
          requestMap.set(request.requestId, request);
        });

      if (loadedRequestsFromDatabase) {
        const databaseRequestIds = new Set(databaseRequests.map((request) => request.requestId));
        const prunedLocalRequests = localRequests.filter((request) => {
          const belongsToMechanic = savedUserId
            ? request.mechanicId === savedUserId
            : providerNames.has(request.mechanicName);

          return !belongsToMechanic || databaseRequestIds.has(request.id);
        });

        if (prunedLocalRequests.length !== localRequests.length) {
          await AsyncStorage.setItem(SERVICE_REQUESTS_STORAGE_KEY, JSON.stringify(prunedLocalRequests));
        }
      } else {
        localRequests
          .filter((request) => {
            if (savedUserId && request.mechanicId === savedUserId) {
              return true;
            }

            return providerNames.has(request.mechanicName);
          })
          .filter((request) => isRequestVisible(request.id, request.status, hiddenRequestIds))
          .forEach((request) => {
            requestMap.set(request.id, {
              id: `local-${request.id}`,
              requestId: request.id,
              type: 'service',
              status: request.status,
              driverName: request.driverName,
              mechanicId: request.mechanicId,
              providerName: request.mechanicName,
              currency: 'GHS',
              requestedAt: request.createdAt,
              createdAt: request.createdAt,
              updatedAt: request.updatedAt,
            });
          });
      }

      const uniqueRequests = Array.from(requestMap.values());
      setTotalRequests(uniqueRequests.length);
      setPendingCount(
        uniqueRequests.filter((request) => request.status === 'pending' || request.status === 'confirmed').length
      );
      setAcceptedCount(uniqueRequests.filter((request) => request.status === 'accepted').length);
    } catch (error) {
      console.error('Error loading requests:', error);
      setTotalRequests(0);
      setPendingCount(0);
      setAcceptedCount(0);
    }

    // Load transactions
    try {
      const [savedUserId, savedMechanicName] = await Promise.all([
        AsyncStorage.getItem(USER_ID_KEY),
        AsyncStorage.getItem(MECHANIC_NAME_KEY),
      ]);
      const deletedPaymentIds = await getDeletedPaymentIds();
      const resolvedPaymentMechanicName = savedMechanicName?.trim() || 'Mechanic';
      const providerNames = new Set<string>();
      if (resolvedPaymentMechanicName && resolvedPaymentMechanicName !== 'Mechanic') {
        providerNames.add(resolvedPaymentMechanicName);
      }
      const paymentShops = await getMechanicShops({ forceRefresh: true }).catch(() => []);
      paymentShops
        .filter((shop) =>
          shop.providerType !== 'tow' &&
          (savedUserId
            ? shop.mechanicId === savedUserId
            : shop.shopName.trim().toLowerCase() === resolvedPaymentMechanicName.toLowerCase())
        )
        .forEach((shop) => providerNames.add(shop.shopName));

      const databasePaymentRecords = await getPaymentRecords({
        mechanicId: savedUserId,
        providerNames: Array.from(providerNames),
        forceRefresh: true,
      }).catch(() => []);
      const paymentRecordsJson = await AsyncStorage.getItem('paymentRecords');
      const paymentRecords = paymentRecordsJson ? JSON.parse(paymentRecordsJson) : [];
      const paymentMap = new Map<string, any>();
      paymentRecords.forEach((record: any) => paymentMap.set(record.paymentId || record.id, record));
      databasePaymentRecords
        .filter((record) => !deletedPaymentIds.has(record.paymentId || record.id))
        .forEach((record) => paymentMap.set(record.paymentId || record.id, record));
      paymentRecords.forEach((record: any) => {
        if (deletedPaymentIds.has(record.paymentId || record.id)) {
          paymentMap.delete(record.paymentId || record.id);
        }
      });

      // Calculate total amount received from completed transactions
      const completedTransactions = Array.from(paymentMap.values()).filter(
        (record: any) => record.status === 'completed' && record.releaseStatus === 'released'
      );

      const total = completedTransactions.reduce(
        (sum: number, record: any) => sum + (record.amount || 0),
        0
      );

      setTotalTransactions(completedTransactions.length);
      setTotalAmountReceived(total);
    } catch (error) {
      console.error('Error loading transactions:', error);
    }
  }, [params.mechanicName]);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
      const refreshTimer = setInterval(loadDashboardData, 3000);

      return () => {
        clearInterval(refreshTimer);
      };
    }, [loadDashboardData])
  );

  useEffect(() => {
    const unsubscribe = subscribeToRequestOverviewChanges(() => {
      loadDashboardData();
    });
    return () => {
      unsubscribe();
    };
  }, [loadDashboardData]);

  useEffect(() => {
    const unsubscribe = subscribeToPaymentHistoryChanges(() => {
      loadDashboardData();
    });
    return () => {
      unsubscribe();
    };
  }, [loadDashboardData]);

  useEffect(() => {
    const intervalId = setInterval(async () => {
      const updatedAt = await AsyncStorage.getItem(REQUEST_OVERVIEW_UPDATED_AT_KEY);
      if (updatedAt && updatedAt !== lastOverviewUpdateRef.current) {
        lastOverviewUpdateRef.current = updatedAt;
        loadDashboardData();
      }
    }, 700);

    return () => clearInterval(intervalId);
  }, [loadDashboardData]);

  const handleRegisterShop = () => {
    router.push('/mechanic-register');
  };

  const handleViewRequests = () => {
    router.push({
      pathname: '/mechanic-inbox',
      params: { mechanicName }
    });
  };

  const handleLogout = async () => {
    await logoutImmediately(() => router.replace('/login'));
  };

  const handleViewTransactions = () => {
    router.push('/transaction-history');
  };

  const handleToggleShopStatus = async (shop: MechanicShopItem) => {
    const nextStatus = shop.status === 'active' ? 'inactive' : 'active';
    setUpdatingShopId(shop.shopId);
    setMechanicShops((currentShops) =>
      currentShops.map((item) =>
        item.shopId === shop.shopId ? { ...item, status: nextStatus } : item
      )
    );

    try {
      const updatedShop = await updateMechanicShopStatus({
        shopId: shop.shopId,
        status: nextStatus,
      });

      setMechanicShops((currentShops) =>
        currentShops.map((item) => (item.shopId === updatedShop.shopId ? updatedShop : item))
      );
    } catch (error) {
      setMechanicShops((currentShops) =>
        currentShops.map((item) =>
          item.shopId === shop.shopId ? { ...item, status: shop.status } : item
        )
      );
      const message = error instanceof Error ? error.message : 'Unable to update shop status.';
      Alert.alert('Error', message);
    } finally {
      setUpdatingShopId(null);
    }
  };

  const handleOpenEditShopName = (shop: MechanicShopItem) => {
    setEditingShop(shop);
    setEditedShopName(shop.shopName);
  };

  const handleCloseEditShopName = () => {
    if (savingShopName) {
      return;
    }

    setEditingShop(null);
    setEditedShopName('');
  };

  const handleSaveShopName = async () => {
    if (!editingShop || savingShopName) {
      return;
    }

    const nextShopName = editedShopName.trim();
    if (!nextShopName) {
      Alert.alert('Shop name required', 'Please enter a shop name.');
      return;
    }

    if (nextShopName === editingShop.shopName) {
      handleCloseEditShopName();
      return;
    }

    const previousShop = editingShop;
    setSavingShopName(true);
    setMechanicShops((currentShops) =>
      currentShops.map((shop) =>
        shop.shopId === previousShop.shopId ? { ...shop, shopName: nextShopName } : shop
      )
    );

    try {
      const updatedShop = await updateMechanicShop({
        shopId: previousShop.shopId,
        shopName: nextShopName,
      });

      setMechanicShops((currentShops) =>
        currentShops.map((shop) => (shop.shopId === updatedShop.shopId ? updatedShop : shop))
      );
      setEditingShop(null);
      setEditedShopName('');
    } catch (error) {
      setMechanicShops((currentShops) =>
        currentShops.map((shop) => (shop.shopId === previousShop.shopId ? previousShop : shop))
      );
      const message = error instanceof Error ? error.message : 'Unable to update shop name.';
      Alert.alert('Error', message);
    } finally {
      setSavingShopName(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <View style={styles.headerSection}>
        <View style={styles.headerTextWrap}>
          <ThemedText style={styles.title}>Mechanic Dashboard</ThemedText>
          <ThemedText style={styles.headerSubtitle}>Welcome, {mechanicName}</ThemedText>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <View style={styles.logoutContent}>
            <AppIcon name="logout" size={18} color="#d32f2f" />
            <ThemedText style={styles.logoutLabel}>Logout</ThemedText>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Register Shop Section */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.registerShopCard}
            onPress={handleRegisterShop}
            activeOpacity={0.8}
          >
            <View style={styles.registerShopContent}>
              <Image source={require('../assets/images/shit.png')} style={styles.registerShopIcon} />
              <View style={styles.registerShopText}>
                <ThemedText style={styles.registerShopTitle}>Register Your Shop</ThemedText>
                <ThemedText style={styles.registerShopSubtitle}>
                  Set up your shop to receive customer requests
                </ThemedText>
              </View>
              <AppIcon name="chevronRight" size={22} color="#FF8C42" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Shops Button Section */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Your Shops</ThemedText>
          <TouchableOpacity
            style={styles.viewShopsButton}
            onPress={() => setShopsModalOpen(true)}
            activeOpacity={0.8}
          >
            <AppIcon name="store" size={24} color="#FF8C42" style={styles.viewShopsIcon} />
            <View style={styles.viewShopsText}>
              <ThemedText style={styles.viewShopsTitle}>View Registered Shops</ThemedText>
              <ThemedText style={styles.viewShopsSubtitle}>
                {mechanicShops.length} {mechanicShops.length === 1 ? 'shop' : 'shops'} added
              </ThemedText>
            </View>
            <AppIcon name="chevronRight" size={20} color="#FF8C42" />
          </TouchableOpacity>
        </View>

        {/* Statistics Section */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Service Requests Overview</ThemedText>
          <View style={styles.statsContainer}>
            <View style={styles.statCard}>
              <AppIcon name="chart" size={28} color="#FF8C42" style={styles.statIcon} />
              <ThemedText style={styles.statValue}>{totalRequests}</ThemedText>
              <ThemedText style={styles.statLabel}>Total Requests</ThemedText>
            </View>

            <View style={styles.statCard}>
              <AppIcon name="timer" size={28} color="#FF8C42" style={styles.statIcon} />
              <ThemedText style={styles.statValue}>{pendingCount}</ThemedText>
              <ThemedText style={styles.statLabel}>Pending</ThemedText>
            </View>

            <View style={styles.statCard}>
              <AppIcon name="check" size={28} color="#FF8C42" style={styles.statIcon} />
              <ThemedText style={styles.statValue}>{acceptedCount}</ThemedText>
              <ThemedText style={styles.statLabel}>Accepted</ThemedText>
            </View>
          </View>
        </View>

        {/* Quick Actions Section */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Quick Actions</ThemedText>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleViewRequests}
          >
            <AppIcon name="inbox" size={24} color="#FF8C42" style={styles.actionButtonIcon} />
            <View style={styles.actionButtonText}>
              <ThemedText style={styles.actionButtonTitle}>View All Requests</ThemedText>
              <ThemedText style={styles.actionButtonSubtitle}>Review service, tow, chat, call, and SMS requests</ThemedText>
            </View>
            <AppIcon name="chevronRight" size={20} color="#FF8C42" />
          </TouchableOpacity>


        </View>

        {/* Transactions Section */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Transactions Received</ThemedText>
          <View style={styles.transactionsContainer}>
            <View style={styles.transactionCard}>
              <AppIcon name="dollar" size={28} color="#FF8C42" style={styles.transactionIcon} />
              <ThemedText style={styles.transactionValue}>GHS {totalAmountReceived.toFixed(2)}</ThemedText>
              <ThemedText style={styles.transactionLabel}>Total Amount</ThemedText>
            </View>

            <TouchableOpacity
              style={[styles.transactionCard, styles.transactionCardClickable]}
              onPress={handleViewTransactions}
              activeOpacity={0.8}
            >
              <AppIcon name="list" size={28} color="#FF8C42" style={styles.transactionIcon} />
              <ThemedText style={styles.transactionValue}>{totalTransactions}</ThemedText>
              <ThemedText style={styles.transactionLabel}>Transactions</ThemedText>
              <AppIcon name="chevronRight" size={18} color="#FF8C42" style={styles.cardCornerChevron} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Bottom Navigation */}
      <BottomNav
        showProfile={false}
        showHome={false}
      />

      <Modal
        visible={shopsModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setShopsModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.shopsModalContent}>
            <View style={styles.modalHeader}>
              <View>
                <ThemedText style={styles.modalTitle}>Your Shops</ThemedText>
                <ThemedText style={styles.modalSubtitle}>
                  {mechanicShops.length} {mechanicShops.length === 1 ? 'registered shop' : 'registered shops'}
                </ThemedText>
              </View>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setShopsModalOpen(false)}
              >
                <AppIcon name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {mechanicShops.length > 0 ? (
              <ScrollView
                style={styles.shopsModalScroll}
                contentContainerStyle={styles.shopsModalScrollContent}
                showsVerticalScrollIndicator
              >
                {mechanicShops.map((shop) => (
                  <View key={shop.id} style={styles.shopCard}>
                    <View style={styles.shopCardHeader}>
                      <View style={styles.shopInitialCircle}>
                        <ThemedText style={styles.shopInitialText}>
                          {shop.shopName.charAt(0).toUpperCase()}
                        </ThemedText>
                      </View>
                      <View style={styles.shopCardText}>
                        <View style={styles.shopNameRow}>
                          <ThemedText style={styles.shopName} numberOfLines={1}>{shop.shopName}</ThemedText>
                          <TouchableOpacity
                            style={styles.editShopNameButton}
                            onPress={() => handleOpenEditShopName(shop)}
                            activeOpacity={0.8}
                            accessibilityRole="button"
                            accessibilityLabel={`Edit ${shop.shopName} shop name`}
                          >
                            <AppIcon name="pencil" size={15} color="#FF8C42" strokeWidth={2.4} />
                          </TouchableOpacity>
                        </View>
                        <ThemedText style={styles.shopLocation}>{shop.location}</ThemedText>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.shopStatusPill,
                          shop.status === 'inactive' && styles.shopStatusPillInactive,
                          updatingShopId === shop.shopId && styles.shopStatusPillDisabled,
                        ]}
                        onPress={() => handleToggleShopStatus(shop)}
                        disabled={updatingShopId === shop.shopId}
                        activeOpacity={0.8}
                      >
                        <ThemedText
                          style={[
                            styles.shopStatusText,
                            shop.status === 'inactive' && styles.shopStatusTextInactive,
                          ]}
                        >
                          {updatingShopId === shop.shopId
                            ? 'Updating'
                            : shop.status === 'active'
                              ? 'Active'
                              : 'Inactive'}
                        </ThemedText>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.shopMetaRow}>
                      <ThemedText style={styles.shopMetaText}>{shop.phone}</ThemedText>
                      <ThemedText style={styles.shopMetaDivider}>•</ThemedText>
                      <ThemedText style={styles.shopMetaText} numberOfLines={1}>
                        {shop.specialization}
                      </ThemedText>
                    </View>
                    <ThemedText style={styles.shopLicenseText}>
                      License: {shop.licenseNumber}
                    </ThemedText>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.emptyShopState}>
                <ThemedText style={styles.emptyShopTitle}>No shops registered yet</ThemedText>
                <ThemedText style={styles.emptyShopText}>
                  Register a shop to make it available to drivers.
                </ThemedText>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!editingShop}
        transparent
        animationType="fade"
        onRequestClose={handleCloseEditShopName}
      >
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalContent}>
            <View style={styles.editModalHeader}>
              <ThemedText style={styles.editModalTitle}>Edit Shop Name</ThemedText>
              <TouchableOpacity
                style={styles.editModalCloseButton}
                onPress={handleCloseEditShopName}
                disabled={savingShopName}
              >
                <AppIcon name="close" size={22} color="#333" />
              </TouchableOpacity>
            </View>
            <ThemedText style={styles.editModalLabel}>Shop name</ThemedText>
            <TextInput
              style={styles.shopNameInput}
              value={editedShopName}
              onChangeText={setEditedShopName}
              placeholder="Enter shop name"
              placeholderTextColor="#999"
              autoCapitalize="words"
              autoCorrect={false}
              editable={!savingShopName}
              selectTextOnFocus
            />
            <View style={styles.editModalActions}>
              <TouchableOpacity
                style={[styles.editModalButton, styles.editModalCancelButton]}
                onPress={handleCloseEditShopName}
                disabled={savingShopName}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.editModalCancelText}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editModalButton, styles.editModalSaveButton, savingShopName && styles.editModalButtonDisabled]}
                onPress={handleSaveShopName}
                disabled={savingShopName}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.editModalSaveText}>
                  {savingShopName ? 'Saving...' : 'Save'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: IS_IOS ? 58 : 50,
    paddingBottom: IS_IOS ? 18 : 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTextWrap: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: IS_IOS ? 24 : 22,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: IS_IOS ? 14 : 13,
    color: '#666',
    textAlign: 'center',
  },
  logoutButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutContent: {
    alignItems: 'center',
  },
  logoutIcon: {
    fontSize: 18,
    marginBottom: 2,
  },
  logoutLabel: {
    fontSize: 10,
    color: '#d32f2f',
    fontWeight: '700',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: IS_IOS ? 20 : 16,
    paddingBottom: 100,
    alignItems: 'center',
  },
  section: {
    marginBottom: 24,
    alignItems: 'center',
    width: '100%',
  },
  sectionTitle: {
    fontSize: IS_IOS ? 17 : 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  registerShopCard: {
    backgroundColor: '#fff3e0',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FF8C42',
    overflow: 'hidden',
    width: '100%',
    maxWidth: 320,
  },
  registerShopContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: IS_IOS ? 18 : 16,
  },
  registerShopIcon: {
    width: IS_IOS ? 58 : 52,
    height: IS_IOS ? 58 : 52,
    marginRight: 12,
    resizeMode: 'contain',
  },
  registerShopText: {
    flex: 1,
  },
  registerShopTitle: {
    fontSize: IS_IOS ? 17 : 16,
    fontWeight: '700',
    color: '#FF8C42',
    marginBottom: 4,
  },
  registerShopSubtitle: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
  },
  registerShopArrow: {
    fontSize: 24,
    color: '#FF8C42',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  viewShopsButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: IS_IOS ? 16 : 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFE0CC',
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
    width: '100%',
    maxWidth: IS_IOS ? 360 : 320,
    alignSelf: 'center',
  },
  viewShopsIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  viewShopsText: {
    flex: 1,
  },
  viewShopsTitle: {
    fontSize: IS_IOS ? 16 : 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  viewShopsSubtitle: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#999',
  },
  viewShopsArrow: {
    fontSize: 20,
    color: '#FF8C42',
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  shopsModalContent: {
    backgroundColor: '#f8f9fa',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: IS_IOS ? 20 : 16,
    paddingTop: IS_IOS ? 18 : 16,
    paddingBottom: IS_IOS ? 32 : 28,
    maxHeight: '82%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: IS_IOS ? 19 : 18,
    fontWeight: '800',
    color: '#333',
  },
  modalSubtitle: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#777',
    marginTop: 2,
  },
  modalCloseButton: {
    width: IS_IOS ? 42 : 36,
    height: IS_IOS ? 42 : 36,
    borderRadius: IS_IOS ? 21 : 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    lineHeight: 26,
  },
  shopsModalScroll: {
    maxHeight: 520,
  },
  shopsModalScrollContent: {
    gap: 10,
    paddingBottom: 10,
  },
  shopCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: IS_IOS ? 16 : 14,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  shopCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  shopInitialCircle: {
    width: IS_IOS ? 48 : 42,
    height: IS_IOS ? 48 : 42,
    borderRadius: IS_IOS ? 24 : 21,
    backgroundColor: '#FFF3E0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  shopInitialText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FF8C42',
  },
  shopCardText: {
    flex: 1,
    minWidth: 0,
  },
  shopNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  shopName: {
    fontSize: IS_IOS ? 16 : 15,
    fontWeight: '800',
    color: '#333',
    flexShrink: 1,
  },
  editShopNameButton: {
    width: IS_IOS ? 36 : 30,
    height: IS_IOS ? 36 : 30,
    borderRadius: IS_IOS ? 18 : 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF3E0',
    marginLeft: 6,
  },
  shopLocation: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
  },
  shopStatusPill: {
    backgroundColor: '#E8F5E9',
    borderRadius: 999,
    paddingHorizontal: IS_IOS ? 12 : 10,
    paddingVertical: IS_IOS ? 6 : 4,
    marginLeft: 8,
  },
  shopStatusPillInactive: {
    backgroundColor: '#FEF2F2',
  },
  shopStatusPillDisabled: {
    opacity: 0.7,
  },
  shopStatusText: {
    fontSize: IS_IOS ? 11 : 10,
    fontWeight: '800',
    color: '#2E7D32',
    textTransform: 'uppercase',
  },
  shopStatusTextInactive: {
    color: '#DC2626',
  },
  shopMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  shopMetaText: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#555',
    flexShrink: 1,
  },
  shopMetaDivider: {
    fontSize: 12,
    color: '#bbb',
  },
  shopLicenseText: {
    fontSize: IS_IOS ? 12 : 11,
    color: '#999',
    fontWeight: '600',
  },
  emptyShopState: {
    width: '100%',
    maxWidth: IS_IOS ? 360 : 320,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    padding: 16,
    alignItems: 'center',
  },
  emptyShopTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#333',
    marginBottom: 4,
  },
  emptyShopText: {
    fontSize: 12,
    color: '#777',
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: IS_IOS ? 360 : 320,
  },
  transactionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: IS_IOS ? 360 : 320,
    alignSelf: 'center',
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: IS_IOS ? 18 : 16,
    marginHorizontal: IS_IOS ? 7 : 6,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#eee',
  },
  statIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  statValue: {
    fontSize: IS_IOS ? 26 : 24,
    fontWeight: '700',
    color: '#FF8C42',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    textAlign: 'center',
  },
  transactionCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: IS_IOS ? 18 : 16,
    marginHorizontal: IS_IOS ? 7 : 6,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#eee',
  },
  transactionCardClickable: {
    backgroundColor: '#fffaf6',
    borderColor: '#FFE0CC',
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
  },
  cardCornerChevron: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  transactionIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  transactionValue: {
    fontSize: IS_IOS ? 19 : 18,
    fontWeight: '700',
    color: '#FF8C42',
    marginBottom: 4,
  },
  transactionLabel: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    textAlign: 'center',
  },
  actionButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: IS_IOS ? 16 : 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFE0CC',
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
    width: '100%',
    maxWidth: IS_IOS ? 360 : 320,
    alignSelf: 'center',
  },
  actionButtonIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  actionButtonText: {
    flex: 1,
  },
  actionButtonTitle: {
    fontSize: IS_IOS ? 16 : 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  actionButtonSubtitle: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#999',
  },
  actionButtonArrow: {
    fontSize: 20,
    color: '#FF8C42',
    marginLeft: 8,
  },
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  editModalContent: {
    width: '100%',
    maxWidth: IS_IOS ? 390 : 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: IS_IOS ? 18 : 16,
  },
  editModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  editModalTitle: {
    fontSize: IS_IOS ? 19 : 18,
    fontWeight: '800',
    color: '#333',
  },
  editModalCloseButton: {
    width: IS_IOS ? 40 : 34,
    height: IS_IOS ? 40 : 34,
    borderRadius: IS_IOS ? 20 : 17,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editModalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  shopNameInput: {
    minHeight: IS_IOS ? 54 : 48,
    borderWidth: 1,
    borderColor: '#dedede',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: IS_IOS ? 16 : 15,
    fontWeight: '600',
    color: '#333',
    backgroundColor: '#fafafa',
  },
  editModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  editModalButton: {
    minWidth: IS_IOS ? 104 : 92,
    minHeight: IS_IOS ? 48 : 42,
    borderRadius: IS_IOS ? 12 : 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  editModalCancelButton: {
    backgroundColor: '#f4f4f5',
  },
  editModalSaveButton: {
    backgroundColor: '#FF8C42',
  },
  editModalButtonDisabled: {
    opacity: 0.7,
  },
  editModalCancelText: {
    fontSize: IS_IOS ? 15 : 14,
    fontWeight: '800',
    color: '#444',
  },
  editModalSaveText: {
    fontSize: IS_IOS ? 15 : 14,
    fontWeight: '800',
    color: '#fff',
  },
});

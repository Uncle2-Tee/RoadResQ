import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppIcon } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import {
  getMechanicShops,
  getPaymentRecords,
  getRequestHistory,
  updateMechanicShop,
  updateMechanicShopStatus,
  type MechanicShopItem,
  type RequestHistoryItem,
} from '../services/api-client';
import { getHiddenRequestIds, isRequestVisible, REQUEST_OVERVIEW_UPDATED_AT_KEY, subscribeToRequestOverviewChanges } from '../services/request-sync';
import { logoutImmediately } from '../services/session';
import { getDeletedPaymentIds, subscribeToPaymentHistoryChanges } from '../services/payment-history-sync';

const TOWER_NAME_KEY = 'towerName';
const USER_ID_KEY = 'userId';
const TOW_REQUESTS_STORAGE_KEY = 'towRequests';
const PENDING_TOW_SHOP_KEY = 'pendingTowShopId';
const towImage = require('../assets/images/tow.jpg');
const IS_IOS = Platform.OS === 'ios';

type LocalTowRequest = {
  id: string;
  type: 'tow';
  shopId?: string;
  mechanicId?: string;
  serviceName: string;
  servicePhone: string;
  driverName: string;
  location: string;
  problemDescription?: string;
  price?: number;
  currency?: string;
  estimatedTime?: number;
  timestamp: string;
  status: RequestHistoryItem['status'];
  acceptedBy?: string;
};

export default function TowerDashboardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [towerName, setTowerName] = useState('Tow Provider');
  const [companies, setCompanies] = useState<MechanicShopItem[]>([]);
  const [recentRequests, setRecentRequests] = useState<RequestHistoryItem[]>([]);
  const [transactionCount, setTransactionCount] = useState(0);
  const [totalAmountReceived, setTotalAmountReceived] = useState(0);
  const [updatingCompanyId, setUpdatingCompanyId] = useState<string | null>(null);
  const [companiesModalOpen, setCompaniesModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<MechanicShopItem | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState('');
  const lastOverviewUpdateRef = useRef<string | null>(null);

  const loadDashboardData = useCallback(async () => {
    const paramName = typeof params.towerName === 'string' ? params.towerName.trim() : '';
    const savedName = await AsyncStorage.getItem(TOWER_NAME_KEY);
    const resolvedName = paramName || savedName || 'Tow Provider';
    setTowerName(resolvedName);

    if (paramName && !savedName) {
      await AsyncStorage.setItem(TOWER_NAME_KEY, paramName);
    }

    const userId = await AsyncStorage.getItem(USER_ID_KEY);
    const shops = await getMechanicShops({
      forceRefresh: true,
      providerType: 'tow',
      includeInactive: true,
      databaseOnly: true,
    }).catch((error) => {
      console.error('Unable to load towing companies from database:', error);
      return null;
    });
    const ownTowCompanies = shops?.filter((shop) => {
      const isTowCompany = shop.providerType?.trim().toLowerCase() === 'tow';
      const belongsToUser = userId
        ? shop.mechanicId === userId
        : shop.shopName.trim().toLowerCase() === resolvedName.toLowerCase();

      return isTowCompany && belongsToUser;
    });
    const visibleTowCompanies = ownTowCompanies
      ? Array.from(new Map(ownTowCompanies.map((company) => [company.shopId || company.id, company])).values())
      : companies;

    if (shops) {
      setCompanies(visibleTowCompanies);
      const pendingCompanyId = await AsyncStorage.getItem(PENDING_TOW_SHOP_KEY);
      const approvedPendingCompany = visibleTowCompanies.find(
        (company) => company.shopId === pendingCompanyId && company.approvalStatus === 'approved'
      );
      if (approvedPendingCompany) {
        await AsyncStorage.removeItem(PENDING_TOW_SHOP_KEY);
        Alert.alert('Registration Approved', `${approvedPendingCompany.shopName} has been approved and is now registered.`);
      }
    }

    const providerNames = visibleTowCompanies.map((company) => company.shopName);
    // A display name is only a fallback before an account has a company. Once
    // companies exist, request ownership must be tied to those companies (or
    // the signed-in account) to avoid counting another provider's requests.
    if (!userId && providerNames.length === 0 && resolvedName && resolvedName !== 'Tow Provider') {
      providerNames.push(resolvedName);
    }

    let loadedRequestsFromDatabase = false;
    const [requests, localTowRequestsJson] = await Promise.all([
      getRequestHistory({
        mechanicId: userId,
        providerNames,
        forceRefresh: true,
      }).then((loadedRequests) => {
        loadedRequestsFromDatabase = true;
        return loadedRequests;
      }).catch(() => []),
      AsyncStorage.getItem(TOW_REQUESTS_STORAGE_KEY),
    ]);
    const hiddenRequestIds = await getHiddenRequestIds();
    const normalizedProviderNames = new Set(
      providerNames.map((providerName) => providerName.trim().toLocaleLowerCase())
    );
    const ownTowRequests = requests.filter((request) => {
      if (request.type !== 'tow') {
        return false;
      }

      if (request.problemDescription?.trim().toLowerCase() === 'called') {
        return false;
      }

      const belongsToUser = Boolean(userId) && request.mechanicId === userId;
      const belongsToCompany = normalizedProviderNames.has(
        request.providerName.trim().toLocaleLowerCase()
      );
      return (belongsToUser || belongsToCompany) && isRequestVisible(request.requestId, request.status, hiddenRequestIds);
    });
    const requestMap = new Map(ownTowRequests.map((request) => [request.requestId, request]));
    const localTowRequests: LocalTowRequest[] = localTowRequestsJson
      ? (JSON.parse(localTowRequestsJson) as LocalTowRequest[])
      : [];
    localTowRequests
      .filter(() => !loadedRequestsFromDatabase)
      .filter((request) => {
        const belongsToUser = Boolean(userId) && request.mechanicId === userId;
        const belongsToCompany = normalizedProviderNames.has(request.serviceName.trim().toLocaleLowerCase());
        return (belongsToUser || belongsToCompany) && isRequestVisible(request.id, request.status, hiddenRequestIds);
      })
      .forEach((request) => {
        // Local state is written synchronously when a driver creates or attends
        // a request, so it provides the immediate dashboard update until the
        // backend response is available.
        requestMap.set(request.id, {
          id: `local-${request.id}`,
          requestId: request.id,
          type: 'tow',
          status: request.status,
          driverName: request.driverName,
          driverLocation: request.location,
          mechanicId: request.mechanicId || request.shopId || null,
          providerName: request.serviceName,
          providerPhone: request.servicePhone,
          problemDescription: request.problemDescription || null,
          price: request.price || 0,
          currency: request.currency || 'GHS',
          estimatedTime: request.estimatedTime || 0,
          acceptedBy: request.acceptedBy || null,
          requestedAt: request.timestamp,
          createdAt: request.timestamp,
          updatedAt: request.timestamp,
        });
      });
    const uniqueTowRequests = Array.from(requestMap.values());
    setRecentRequests(
      uniqueTowRequests
        .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
    );

    const [payments, deletedPaymentIds] = await Promise.all([
      getPaymentRecords({
      mechanicId: userId,
      providerNames,
      forceRefresh: true,
      }).catch(() => []),
      getDeletedPaymentIds(),
    ]);
    const visiblePayments = payments.filter((payment) => !deletedPaymentIds.has(payment.paymentId || payment.id));
    setTransactionCount(visiblePayments.length);
    setTotalAmountReceived(
      visiblePayments
        .filter((payment) => payment.status === 'completed' && payment.releaseStatus === 'released')
        .reduce((total, payment) => total + (payment.amount || 0), 0)
    );
  }, [params.towerName]);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
      const refreshTimer = setInterval(loadDashboardData, 3000);

      return () => clearInterval(refreshTimer);
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

  const handleToggleStatus = async (company: MechanicShopItem) => {
    const nextStatus = company.status === 'active' ? 'inactive' : 'active';
    const companyKey = `${company.providerType}:${company.shopId}`;
    setUpdatingCompanyId(companyKey);
    setCompanies((current) =>
      current.map((item) => (item.shopId === company.shopId ? { ...item, status: nextStatus } : item))
    );

    try {
      const updatedCompany = await updateMechanicShopStatus({
        shopId: company.shopId,
        status: nextStatus,
        providerType: company.providerType,
      });
      const localCompaniesJson = await AsyncStorage.getItem('registeredTowCompanies');
      const localCompanies = localCompaniesJson ? JSON.parse(localCompaniesJson) : [];
      const updatedLocalCompanies = localCompanies.map((item: any) => {
        const sameCompany =
          item.id === updatedCompany.shopId ||
          item.id === updatedCompany.id ||
          item.licenseNumber === updatedCompany.licenseNumber ||
          item.name === updatedCompany.shopName;

        return sameCompany ? { ...item, status: updatedCompany.status } : item;
      });
      await AsyncStorage.setItem('registeredTowCompanies', JSON.stringify(updatedLocalCompanies));
      setCompanies((current) =>
        current.map((item) => (item.shopId === updatedCompany.shopId ? updatedCompany : item))
      );
    } catch (error) {
      setCompanies((current) =>
        current.map((item) => (item.shopId === company.shopId ? company : item))
      );
      const message = error instanceof Error ? error.message : 'Unable to update towing company status.';
      Alert.alert('Error', message);
    } finally {
      setUpdatingCompanyId(null);
    }
  };

  const handleOpenEditCompany = (company: MechanicShopItem) => {
    setEditingCompany(company);
    setEditingCompanyName(company.shopName);
  };

  const handleCloseEditCompany = () => {
    setEditingCompany(null);
    setEditingCompanyName('');
  };

  const handleSaveCompanyName = async () => {
    if (!editingCompany || updatingCompanyId) {
      return;
    }

    const nextName = editingCompanyName.trim();
    if (!nextName) {
      Alert.alert('Missing field', 'Please enter the company name.');
      return;
    }

    if (nextName === editingCompany.shopName) {
      handleCloseEditCompany();
      return;
    }

    setUpdatingCompanyId(editingCompany.shopId);
    setCompanies((current) =>
      current.map((item) => (item.shopId === editingCompany.shopId ? { ...item, shopName: nextName } : item))
    );

    try {
      const updatedCompany = await updateMechanicShop({
        shopId: editingCompany.shopId,
        shopName: nextName,
      });
      const localCompaniesJson = await AsyncStorage.getItem('registeredTowCompanies');
      const localCompanies = localCompaniesJson ? JSON.parse(localCompaniesJson) : [];
      const updatedLocalCompanies = localCompanies.map((item: any) => {
        const sameCompany =
          item.id === updatedCompany.shopId ||
          item.shopId === updatedCompany.shopId ||
          item.id === updatedCompany.id ||
          item.licenseNumber === updatedCompany.licenseNumber ||
          item.name === editingCompany.shopName ||
          item.shopName === editingCompany.shopName;

        return sameCompany ? { ...item, name: updatedCompany.shopName, shopName: updatedCompany.shopName } : item;
      });
      await AsyncStorage.setItem('registeredTowCompanies', JSON.stringify(updatedLocalCompanies));
      setCompanies((current) =>
        current.map((item) => (item.shopId === updatedCompany.shopId ? updatedCompany : item))
      );
      handleCloseEditCompany();
      Alert.alert('Success', 'Company name updated.');
    } catch (error) {
      setCompanies((current) =>
        current.map((item) => (item.shopId === editingCompany.shopId ? editingCompany : item))
      );
      const message = error instanceof Error ? error.message : 'Unable to update company name.';
      Alert.alert('Error', message);
    } finally {
      setUpdatingCompanyId(null);
    }
  };

  const acceptedCount = recentRequests.filter((request) => request.status.toLowerCase() === 'accepted').length;
  const pendingCount = recentRequests.filter((request) => ['pending', 'confirmed'].includes(request.status.toLowerCase())).length;
  const totalRequests = recentRequests.length;
  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <View style={styles.headerText}>
          <ThemedText style={styles.title}>Tow Dashboard</ThemedText>
          <ThemedText style={styles.subtitle}>Welcome, {towerName}</ThemedText>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={() => logoutImmediately(() => router.replace('/login'))}>
          <AppIcon name="logout" size={20} color="#d32f2f" />
          <ThemedText style={styles.logoutLabel}>Logout</ThemedText>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={styles.registerCard}
          onPress={() => router.push('/tower-register')}
          activeOpacity={0.85}
        >
          <View style={styles.registerIcon}>
            <Image source={towImage} style={styles.registerIconImage} resizeMode="cover" />
          </View>
          <View style={styles.registerText}>
            <ThemedText style={styles.registerTitle} numberOfLines={2}>Register Towing Company</ThemedText>
            <ThemedText style={styles.registerSubtitle}>
              Add or update your company details
            </ThemedText>
          </View>
          <AppIcon name="chevronRight" size={22} color="#FF8C42" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.viewCompaniesButton}
          onPress={() => setCompaniesModalOpen(true)}
          activeOpacity={0.85}
        >
          <Image source={towImage} style={styles.inlineTowImage} resizeMode="cover" />
          <View style={styles.viewCompaniesText}>
            <ThemedText style={styles.viewCompaniesTitle} numberOfLines={2}>View Registered Companies</ThemedText>
            <ThemedText style={styles.viewCompaniesSubtitle}>
              {companies.length} {companies.length === 1 ? 'company' : 'companies'} added
            </ThemedText>
          </View>
          <AppIcon name="chevronRight" size={20} color="#FF8C42" />
        </TouchableOpacity>

        <ThemedText style={styles.sectionTitle}>Towing Requests Overview</ThemedText>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <AppIcon name="chart" size={28} color="#FF8C42" />
            <ThemedText style={styles.statValue}>{totalRequests}</ThemedText>
            <ThemedText style={styles.statLabel} numberOfLines={2}>Total Requests</ThemedText>
          </View>
          <View style={styles.statCard}>
            <AppIcon name="timer" size={28} color="#FF8C42" />
            <ThemedText style={styles.statValue}>{pendingCount}</ThemedText>
            <ThemedText style={styles.statLabel} numberOfLines={2}>Pending</ThemedText>
          </View>
          <View style={styles.statCard}>
            <AppIcon name="check" size={28} color="#FF8C42" />
            <ThemedText style={styles.statValue}>{acceptedCount}</ThemedText>
            <ThemedText style={styles.statLabel} numberOfLines={2}>Accepted</ThemedText>
          </View>
        </View>

        <ThemedText style={styles.sectionTitle}>Quick Actions</ThemedText>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => router.push('/request')}
          activeOpacity={0.85}
        >
          <AppIcon name="inbox" size={24} color="#FF8C42" />
          <View style={styles.actionButtonText}>
            <ThemedText style={styles.actionButtonTitle} numberOfLines={1}>View All Requests</ThemedText>
            <ThemedText style={styles.actionButtonSubtitle} numberOfLines={2}>Review tow, call, SMS, and accepted jobs</ThemedText>
          </View>
          <AppIcon name="chevronRight" size={20} color="#FF8C42" />
        </TouchableOpacity>

        <ThemedText style={styles.sectionTitle}>Transactions Received</ThemedText>
        <View style={styles.transactionsRow}>
          <View style={styles.transactionCard}>
            <AppIcon name="dollar" size={28} color="#FF8C42" />
            <ThemedText style={styles.transactionValue} numberOfLines={1}>GHS {totalAmountReceived.toFixed(2)}</ThemedText>
            <ThemedText style={styles.transactionLabel} numberOfLines={2}>Total Amount</ThemedText>
          </View>
          <TouchableOpacity
            style={[styles.transactionCard, styles.clickableCard]}
            onPress={() => router.push('/transaction-history')}
            activeOpacity={0.85}
          >
              <AppIcon name="list" size={28} color="#FF8C42" />
              <ThemedText style={styles.transactionValue}>{transactionCount}</ThemedText>
              <ThemedText style={styles.transactionLabel} numberOfLines={2}>Transactions</ThemedText>
            </TouchableOpacity>
        </View>
      </ScrollView>

      <BottomNav showProfile={false} showHome={false} />

      <Modal
        visible={companiesModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCompaniesModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <ThemedText style={styles.modalTitle}>Your Towing Companies</ThemedText>
                <ThemedText style={styles.modalSubtitle}>
                  {companies.length} {companies.length === 1 ? 'registered company' : 'registered companies'}
                </ThemedText>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setCompaniesModalOpen(false)}>
                <AppIcon name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {companies.length > 0 ? (
              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
                {companies.map((company) => (
                  <View key={company.id} style={styles.companyCard}>
                    <View style={styles.companyHeader}>
                      <View style={styles.companyInitialCircle}>
                        <Image source={towImage} style={styles.companyInitialImage} resizeMode="cover" />
                      </View>
                      <View style={styles.companyText}>
                        <ThemedText style={styles.companyName} numberOfLines={1}>{company.shopName}</ThemedText>
                        <ThemedText style={styles.companyLocation} numberOfLines={1}>{company.location}</ThemedText>
                      </View>
                      <TouchableOpacity
                        style={styles.editCompanyButton}
                        onPress={() => handleOpenEditCompany(company)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${company.shopName}`}
                      >
                        <AppIcon name="pencil" size={18} color="#FF8C42" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.statusButton,
                          company.status === 'inactive' && styles.statusButtonInactive,
                          updatingCompanyId === `${company.providerType}:${company.shopId}` && styles.statusButtonDisabled,
                        ]}
                        onPress={() => handleToggleStatus(company)}
                        disabled={updatingCompanyId === `${company.providerType}:${company.shopId}`}
                        activeOpacity={0.85}
                      >
                        <ThemedText
                          style={[
                            styles.statusText,
                            company.status === 'inactive' && styles.statusTextInactive,
                          ]}
                        >
                          {updatingCompanyId === `${company.providerType}:${company.shopId}`
                            ? 'Updating'
                            : company.status === 'active'
                              ? 'Active'
                              : 'Inactive'}
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                    <ThemedText style={styles.companyMeta}>{company.phone}</ThemedText>
                    <ThemedText style={styles.companyMeta}>{company.specialization}</ThemedText>
                    <ThemedText style={styles.companyLicense}>License: {company.licenseNumber}</ThemedText>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.emptyState}>
                <ThemedText style={styles.emptyTitle}>No towing company registered yet</ThemedText>
                <ThemedText style={styles.emptyText}>Register a towing company to make it visible to drivers.</ThemedText>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(editingCompany)}
        transparent
        animationType="fade"
        onRequestClose={handleCloseEditCompany}
      >
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalContent}>
            <View style={styles.editModalHeader}>
              <View>
                <ThemedText style={styles.editModalTitle}>Edit Company Name</ThemedText>
                <ThemedText style={styles.editModalSubtitle}>Update the name drivers will see</ThemedText>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={handleCloseEditCompany}>
                <AppIcon name="close" size={22} color="#333" />
              </TouchableOpacity>
            </View>

            <ThemedText style={styles.editInputLabel}>Company Name</ThemedText>
            <TextInput
              style={styles.editInput}
              value={editingCompanyName}
              onChangeText={setEditingCompanyName}
              placeholder="Enter company name"
              placeholderTextColor="#999"
              autoCapitalize="words"
            />

            <View style={styles.editActionsRow}>
              <TouchableOpacity
                style={[styles.editActionButton, styles.cancelEditButton]}
                onPress={handleCloseEditCompany}
                activeOpacity={0.85}
              >
                <ThemedText style={styles.cancelEditButtonText}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.editActionButton,
                  styles.saveEditButton,
                  editingCompany && updatingCompanyId === editingCompany.shopId && styles.saveEditButtonDisabled,
                ]}
                onPress={handleSaveCompanyName}
                disabled={Boolean(editingCompany && updatingCompanyId === editingCompany.shopId)}
                activeOpacity={0.85}
              >
                <ThemedText style={styles.saveEditButtonText}>
                  {editingCompany && updatingCompanyId === editingCompany.shopId ? 'Saving...' : 'Save'}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: IS_IOS ? 54 : 42,
    paddingBottom: IS_IOS ? 14 : 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e6e6e6',
  },
  headerText: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  title: {
    fontSize: IS_IOS ? 23 : 21,
    fontWeight: '800',
    color: '#333',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    marginTop: 2,
    textAlign: 'center',
  },
  headerSpacer: {
    width: IS_IOS ? 54 : 48,
    height: IS_IOS ? 48 : 42,
  },
  logoutButton: {
    width: IS_IOS ? 54 : 48,
    minHeight: IS_IOS ? 48 : 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#d32f2f',
    marginTop: 2,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: IS_IOS ? 22 : 20,
    paddingVertical: IS_IOS ? 26 : 24,
    paddingBottom: 110,
  },
  registerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: IS_IOS ? 14 : 12,
    padding: IS_IOS ? 18 : 16,
    marginBottom: IS_IOS ? 16 : 14,
    borderWidth: 1,
    borderColor: '#FFE0CC',
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
  },
  registerIcon: {
    width: IS_IOS ? 58 : 52,
    height: IS_IOS ? 58 : 52,
    borderRadius: IS_IOS ? 29 : 26,
    backgroundColor: '#FF8C42',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    overflow: 'hidden',
  },
  registerIconImage: {
    width: IS_IOS ? 58 : 52,
    height: IS_IOS ? 58 : 52,
  },
  registerText: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  registerTitle: {
    fontSize: IS_IOS ? 17 : 16,
    fontWeight: '800',
    color: '#333',
    textAlign: 'center',
  },
  registerSubtitle: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    lineHeight: IS_IOS ? 19 : 17,
    marginTop: 4,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  statCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#fff',
    borderRadius: IS_IOS ? 12 : 10,
    padding: IS_IOS ? 16 : 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  statValue: {
    fontSize: IS_IOS ? 26 : 24,
    fontWeight: '800',
    color: '#333',
    marginTop: 8,
  },
  statLabel: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    marginTop: 2,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: IS_IOS ? 17 : 16,
    fontWeight: '800',
    color: '#FF8C42',
    marginTop: 4,
    marginBottom: 10,
    textAlign: 'center',
  },
  viewCompaniesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: IS_IOS ? 12 : 10,
    padding: IS_IOS ? 16 : 14,
    borderWidth: 1,
    borderColor: '#FFE0CC',
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
    marginBottom: 18,
  },
  inlineTowImage: {
    width: IS_IOS ? 38 : 34,
    height: IS_IOS ? 32 : 28,
    borderRadius: 7,
    marginRight: 12,
  },
  viewCompaniesText: {
    flex: 1,
    marginLeft: 12,
    alignItems: 'center',
  },
  viewCompaniesTitle: {
    fontSize: IS_IOS ? 16 : 15,
    fontWeight: '800',
    color: '#333',
    textAlign: 'center',
  },
  viewCompaniesSubtitle: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    marginTop: 3,
    textAlign: 'center',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: IS_IOS ? 12 : 10,
    padding: IS_IOS ? 16 : 14,
    borderWidth: 1,
    borderColor: '#FFE0CC',
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
    marginBottom: 18,
  },
  actionButtonText: {
    flex: 1,
    marginLeft: 12,
    alignItems: 'center',
  },
  actionButtonTitle: {
    fontSize: IS_IOS ? 16 : 15,
    fontWeight: '800',
    color: '#333',
    textAlign: 'center',
  },
  actionButtonSubtitle: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    marginTop: 3,
    textAlign: 'center',
  },
  transactionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 22,
  },
  transactionCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#fff',
    borderRadius: IS_IOS ? 12 : 10,
    padding: IS_IOS ? 16 : 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  clickableCard: {
    borderColor: '#FFE0CC',
    backgroundColor: '#fffaf6',
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
  },
  transactionValue: {
    fontSize: IS_IOS ? 15 : 14,
    fontWeight: '800',
    color: '#333',
    marginTop: 8,
    textAlign: 'center',
    width: '100%',
  },
  transactionLabel: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    marginTop: 3,
    textAlign: 'center',
  },
  statusButton: {
    borderRadius: 16,
    paddingHorizontal: IS_IOS ? 12 : 10,
    paddingVertical: IS_IOS ? 8 : 6,
    backgroundColor: '#E8F7EF',
  },
  statusButtonInactive: {
    backgroundColor: '#FDECEC',
  },
  statusButtonDisabled: {
    opacity: 0.7,
  },
  statusText: {
    fontSize: IS_IOS ? 12 : 11,
    fontWeight: '800',
    color: '#15803d',
  },
  statusTextInactive: {
    color: '#d32f2f',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modalContent: {
    maxHeight: '78%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: IS_IOS ? 22 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: IS_IOS ? 21 : 20,
    fontWeight: '800',
    color: '#333',
  },
  modalSubtitle: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    marginTop: 3,
  },
  modalCloseButton: {
    width: IS_IOS ? 44 : 40,
    height: IS_IOS ? 44 : 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScroll: {
    maxHeight: 420,
  },
  modalScrollContent: {
    paddingBottom: 18,
  },
  companyCard: {
    backgroundColor: '#fff',
    borderRadius: IS_IOS ? 12 : 10,
    padding: IS_IOS ? 16 : 14,
    marginBottom: IS_IOS ? 14 : 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  companyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  companyInitialCircle: {
    width: IS_IOS ? 48 : 42,
    height: IS_IOS ? 48 : 42,
    borderRadius: IS_IOS ? 24 : 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF0E6',
    marginRight: 12,
    overflow: 'hidden',
  },
  companyInitialImage: {
    width: IS_IOS ? 48 : 42,
    height: IS_IOS ? 48 : 42,
  },
  companyInitialText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FF8C42',
  },
  companyText: {
    flex: 1,
  },
  companyName: {
    fontSize: IS_IOS ? 17 : 16,
    fontWeight: '800',
    color: '#333',
  },
  companyLocation: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    marginTop: 3,
  },
  editCompanyButton: {
    width: IS_IOS ? 40 : 36,
    height: IS_IOS ? 40 : 36,
    borderRadius: IS_IOS ? 20 : 18,
    backgroundColor: '#FFF3E8',
    borderWidth: 1,
    borderColor: '#FFE0CC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  companyMeta: {
    fontSize: IS_IOS ? 14 : 13,
    color: '#444',
    marginBottom: 6,
  },
  companyLicense: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#777',
  },
  emptyState: {
    alignItems: 'center',
    padding: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#333',
  },
  emptyText: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 6,
  },
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  editModalContent: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: IS_IOS ? 20 : 18,
    borderWidth: 1,
    borderColor: '#FFE0CC',
  },
  editModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  editModalTitle: {
    fontSize: IS_IOS ? 19 : 18,
    fontWeight: '800',
    color: '#333',
  },
  editModalSubtitle: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#666',
    marginTop: 3,
  },
  editInputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  editInput: {
    minHeight: IS_IOS ? 54 : 50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 14,
    fontSize: IS_IOS ? 16 : 15,
    color: '#333',
    marginBottom: 18,
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  editActionButton: {
    flex: 1,
    minHeight: IS_IOS ? 52 : 46,
    borderRadius: IS_IOS ? 12 : 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cancelEditButton: {
    backgroundColor: '#fff',
    borderColor: '#ddd',
  },
  cancelEditButtonText: {
    fontSize: IS_IOS ? 15 : 14,
    fontWeight: '800',
    color: '#555',
  },
  saveEditButton: {
    backgroundColor: '#FF8C42',
    borderColor: '#FF8C42',
  },
  saveEditButtonDisabled: {
    opacity: 0.7,
  },
  saveEditButtonText: {
    fontSize: IS_IOS ? 15 : 14,
    fontWeight: '800',
    color: '#fff',
  },
});

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppIcon } from '../components/app-icon';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { logoutImmediately } from '../services/session';
import {
  getAdminMechanicShops,
  getAdminPayments,
  updateAdminMechanicShopStatus,
  updateAdminPaymentRelease,
  type AdminPaymentItem,
  type MechanicShopItem,
  type PaymentReleaseStatus,
  type ShopApprovalStatus,
} from '../services/api-client';

export default function AdminDashboardScreen() {
  const router = useRouter();
  const [shops, setShops] = useState<MechanicShopItem[]>([]);
  const [payments, setPayments] = useState<AdminPaymentItem[]>([]);
  const [activeTab, setActiveTab] = useState<'registrations' | 'payments'>('registrations');
  const [loading, setLoading] = useState(true);
  const [updatingShopId, setUpdatingShopId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [shopsResult, paymentsResult] = await Promise.allSettled([
        getAdminMechanicShops(),
        getAdminPayments(),
      ]);

      if (shopsResult.status === 'rejected') {
        throw shopsResult.reason;
      }

      setShops(shopsResult.value);
      if (paymentsResult.status === 'fulfilled') {
        setPayments(paymentsResult.value);
      } else {
        setPayments([]);
        Alert.alert(
          'Payment approvals unavailable',
          paymentsResult.reason instanceof Error
            ? paymentsResult.reason.message
            : 'Unable to load payment approvals. Restart the backend and try again.'
        );
      }
    } catch (error) {
      Alert.alert('Admin access denied', error instanceof Error ? error.message : 'Unable to load shop approvals.');
      router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateStatus = async (shop: MechanicShopItem, status: ShopApprovalStatus) => {
    const shopKey = `${shop.providerType}:${shop.shopId}`;
    setUpdatingShopId(shopKey);
    try {
      const updatedShop = await updateAdminMechanicShopStatus(shop.shopId, status, shop.providerType);
      setShops((current) => status === 'approved'
        ? current.filter((item) => item.providerType !== updatedShop.providerType || item.shopId !== updatedShop.shopId)
        : current.map((item) => item.providerType === updatedShop.providerType && item.shopId === updatedShop.shopId ? updatedShop : item));
    } catch (error) {
      Alert.alert('Approval failed', error instanceof Error ? error.message : 'Unable to update shop approval.');
    } finally {
      setUpdatingShopId(null);
    }
  };

  const updatePayment = async (payment: AdminPaymentItem, releaseStatus: PaymentReleaseStatus) => {
    try {
      const updatedPayment = await updateAdminPaymentRelease(payment.paymentId, releaseStatus);
      setPayments((current) => current.map((item) => item.paymentId === updatedPayment.paymentId ? updatedPayment : item));
      Alert.alert(releaseStatus === 'released' ? 'Payment released' : 'Payment rejected', releaseStatus === 'released'
        ? 'The payment has been approved for release to the provider.'
        : 'The payment release has been rejected.');
    } catch (error) {
      Alert.alert('Payment update failed', error instanceof Error ? error.message : 'Unable to update payment release.');
    }
  };

  const getReleaseStatus = (payment: AdminPaymentItem) =>
    String(payment.releaseStatus || 'pending').trim().toLowerCase();
  const pendingPayments = payments.filter((payment) => getReleaseStatus(payment) === 'pending');
  const releasedPayments = payments.filter((payment) => getReleaseStatus(payment) === 'released');

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => logoutImmediately(() => router.replace('/login'))} accessibilityLabel="Log out">
          <AppIcon name="logout" size={21} color="#C2410C" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <ThemedText style={styles.title}>Admin Dashboard</ThemedText>
          <ThemedText style={styles.subtitle}>Review mechanic and towing registrations</ThemedText>
        </View>
        <TouchableOpacity style={styles.iconButton} onPress={loadData} accessibilityLabel="Refresh admin data">
          <AppIcon name="refresh" size={21} color="#C2410C" />
        </TouchableOpacity>
      </View>
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tab, activeTab === 'registrations' && styles.activeTab]} onPress={() => setActiveTab('registrations')}>
          <ThemedText style={[styles.tabText, activeTab === 'registrations' && styles.activeTabText]}>Registrations</ThemedText>
          <View style={styles.tabCount}><ThemedText style={styles.tabCountText}>{shops.length}</ThemedText></View>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'payments' && styles.activeTab]} onPress={() => setActiveTab('payments')}>
          <ThemedText style={[styles.tabText, activeTab === 'payments' && styles.activeTabText]}>Payment Release</ThemedText>
          <View style={styles.tabCount}><ThemedText style={styles.tabCountText}>{pendingPayments.length}</ThemedText></View>
        </TouchableOpacity>
      </View>
      {loading ? <ActivityIndicator style={styles.loader} size="large" color="#C2410C" /> : activeTab === 'registrations' ? (
        <FlatList
          contentContainerStyle={styles.list}
          data={shops}
          keyExtractor={(item) => `${item.providerType}:${item.shopId}`}
          refreshing={loading}
          onRefresh={loadData}
          ListEmptyComponent={<ThemedText style={styles.empty}>No shop registrations found.</ThemedText>}
          renderItem={({ item }) => {
            const approvalStatus = item.approvalStatus || 'pending';
            const pending = approvalStatus === 'pending';
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitle}>
                    <ThemedText style={styles.shopName}>{item.shopName}</ThemedText>
                    <ThemedText style={styles.providerType}>{item.providerType === 'tow' ? 'Towing company' : 'Mechanic shop'}</ThemedText>
                  </View>
                  <View style={[styles.status, approvalStatus === 'approved' ? styles.approved : approvalStatus === 'rejected' ? styles.rejected : styles.pending]}>
                    <ThemedText style={styles.statusText}>{approvalStatus}</ThemedText>
                  </View>
                </View>
                <ThemedText style={styles.detail}>{item.location}</ThemedText>
                <ThemedText style={styles.detail}>{item.phone}</ThemedText>
                <ThemedText style={styles.detail}>License: {item.licenseNumber}</ThemedText>
                {pending && <View style={styles.actions}>
                  <TouchableOpacity style={[styles.action, styles.rejectAction]} disabled={updatingShopId === `${item.providerType}:${item.shopId}`} onPress={() => updateStatus(item, 'rejected')}>
                    <ThemedText style={styles.rejectText}>Reject</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.action, styles.approveAction]} disabled={updatingShopId === `${item.providerType}:${item.shopId}`} onPress={() => updateStatus(item, 'approved')}>
                    <ThemedText style={styles.approveText}>{updatingShopId === `${item.providerType}:${item.shopId}` ? 'Updating...' : 'Approve'}</ThemedText>
                  </TouchableOpacity>
                </View>}
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={payments}
          keyExtractor={(item) => item.paymentId}
          refreshing={loading}
          onRefresh={loadData}
          ListHeaderComponent={
            <View style={styles.paymentSummary}>
              <View><ThemedText style={styles.summaryLabel}>Awaiting release</ThemedText><ThemedText style={styles.summaryValue}>{pendingPayments.length}</ThemedText></View>
              <View><ThemedText style={styles.summaryLabel}>Released</ThemedText><ThemedText style={styles.summaryValue}>{releasedPayments.length}</ThemedText></View>
            </View>
          }
          ListEmptyComponent={<ThemedText style={styles.empty}>No payment records found.</ThemedText>}
          renderItem={({ item }) => {
            const releaseStatus = getReleaseStatus(item);
            const released = releaseStatus === 'released';
            const pending = releaseStatus === 'pending';
            const eligible = item.canRelease && pending;
            const statusLabel = released ? 'Released' : releaseStatus === 'rejected' ? 'Declined' : 'Awaiting review';
            return (
              <View style={styles.paymentCard}>
                <View style={styles.paymentCardTop}>
                  <View style={styles.paymentTypeIcon}>
                    <AppIcon name="wallet" size={20} color="#C2410C" />
                  </View>
                  <View style={styles.paymentTitleBlock}>
                    <ThemedText style={styles.paymentProvider} numberOfLines={1}>{item.providerName || item.mechanicName || 'Unassigned provider'}</ThemedText>
                  </View>
                  <View style={[styles.paymentStatus, released ? styles.paymentStatusReleased : releaseStatus === 'rejected' ? styles.paymentStatusRejected : styles.paymentStatusPending]}>
                    <View style={[styles.statusDot, released ? styles.statusDotReleased : releaseStatus === 'rejected' ? styles.statusDotRejected : null]} />
                    <ThemedText style={[styles.paymentStatusText, released ? styles.paymentStatusTextReleased : releaseStatus === 'rejected' ? styles.paymentStatusTextRejected : null]}>{statusLabel}</ThemedText>
                  </View>
                </View>
                <View style={styles.amountBand}>
                  <View>
                    <ThemedText style={styles.amountLabel}>Payment amount</ThemedText>
                    <ThemedText style={styles.amount}>GHS {item.amount.toFixed(2)}</ThemedText>
                  </View>
                </View>
                <View style={styles.paymentDetails}>
                  <View style={styles.detailItem}>
                    <AppIcon name="user" size={16} color="#9A6A4F" />
                    <View><ThemedText style={styles.detailLabel}>Driver</ThemedText><ThemedText style={styles.detailValue} numberOfLines={1}>{item.driverName}</ThemedText></View>
                  </View>
                  <View style={styles.detailItem}>
                    <AppIcon name="check" size={16} color={item.canRelease ? '#047857' : '#9A6A4F'} />
                    <View><ThemedText style={styles.detailLabel}>Service</ThemedText><ThemedText style={styles.detailValue}>{item.serviceStatus || 'Not linked'}</ThemedText></View>
                  </View>
                </View>
                {pending && <View style={styles.actions}>
                  <TouchableOpacity style={[styles.paymentAction, styles.rejectAction]} onPress={() => updatePayment(item, 'rejected')}>
                    <AppIcon name="close" size={16} color="#DC2626" />
                    <ThemedText style={styles.rejectText}>Decline</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.paymentAction, styles.approveAction, !eligible && styles.approveActionDisabled]} onPress={() => updatePayment(item, 'released')}>
                    <AppIcon name="check" size={16} color="#047857" />
                    <ThemedText style={styles.approveText}>Approve</ThemedText>
                  </TouchableOpacity>
                </View>}
              </View>
            );
          }}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F2' },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: 16, paddingBottom: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F3E2D4' },
  headerText: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontWeight: '800', color: '#202936', textAlign: 'center' },
  subtitle: { width: '100%', marginTop: 3, fontSize: 12, color: '#747474', textAlign: 'center', alignSelf: 'center' },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1E6' },
  loader: { marginTop: 40 },
  tabBar: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 14, gap: 10, backgroundColor: '#FFFFFF' },
  tab: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderBottomWidth: 2, borderBottomColor: '#F3E2D4' },
  activeTab: { borderBottomColor: '#C2410C' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#7C6F66' },
  activeTabText: { color: '#C2410C' },
  tabCount: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1E6' },
  tabCountText: { fontSize: 11, fontWeight: '800', color: '#C2410C' },
  list: { padding: 16, paddingBottom: 32 },
  empty: { marginTop: 48, textAlign: 'center', color: '#777' },
  card: { minHeight: 164, marginBottom: 10, padding: 14, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F0E1D5', shadowColor: '#9A6A4F', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.07, shadowRadius: 7, elevation: 2 },
  paymentCard: { minHeight: 176, marginBottom: 10, padding: 14, borderRadius: 14, backgroundColor: '#FFFCFA', borderWidth: 1, borderColor: '#F0E1D5', shadowColor: '#9A6A4F', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.07, shadowRadius: 7, elevation: 2 },
  paymentCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paymentTypeIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1E6' },
  paymentTitleBlock: { flex: 1, minWidth: 0 },
  paymentProvider: { fontSize: 15, fontWeight: '800', color: '#202936' },
  paymentStatus: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 999 },
  paymentStatusPending: { backgroundColor: '#FFF4D8' },
  paymentStatusReleased: { backgroundColor: '#E8F8EF' },
  paymentStatusRejected: { backgroundColor: '#FDECEC' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D97706' },
  statusDotReleased: { backgroundColor: '#059669' },
  statusDotRejected: { backgroundColor: '#DC2626' },
  paymentStatusText: { fontSize: 11, fontWeight: '800', color: '#8A5A00' },
  paymentStatusTextReleased: { color: '#047857' },
  paymentStatusTextRejected: { color: '#B91C1C' },
  amountBand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7, padding: 8, borderRadius: 11, backgroundColor: '#FFF4EA' },
  amountLabel: { fontSize: 11, fontWeight: '700', color: '#9A6A4F' },
  paymentDetails: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 7 },
  detailItem: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 6, minWidth: 0 },
  detailLabel: { fontSize: 10, color: '#9A8A80' },
  detailValue: { maxWidth: 82, marginTop: 2, fontSize: 11, fontWeight: '700', color: '#3E454D' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  cardTitle: { flex: 1 },
  shopName: { fontSize: 17, fontWeight: '800', color: '#202936' },
  amount: { marginBottom: 4, fontSize: 22, fontWeight: '800', color: '#202936' },
  providerType: { marginTop: 3, fontSize: 13, color: '#6D737B' },
  status: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pending: { backgroundColor: '#FFF3E6' },
  approved: { backgroundColor: '#E9FBF2' },
  rejected: { backgroundColor: '#FEF2F2' },
  statusText: { fontSize: 12, fontWeight: '700', color: '#555' },
  detail: { marginTop: 5, fontSize: 13, color: '#555' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 9 },
  action: { flex: 1, minHeight: 44, borderRadius: 12, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  paymentAction: { flex: 1, minHeight: 34, paddingHorizontal: 8, borderRadius: 9, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  rejectAction: { backgroundColor: '#FFF1F2', borderColor: '#FDA4AF' },
  approveAction: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' },
  approveActionDisabled: { backgroundColor: '#ECFDF5', borderColor: '#BBF7D0', opacity: 0.75 },
  rejectText: { color: '#DC2626', fontWeight: '800' },
  approveText: { color: '#047857', fontWeight: '800' },
  disabledAction: { backgroundColor: '#F5F5F5', borderColor: '#E5E7EB' },
  paymentSummary: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14, padding: 16, borderRadius: 16, backgroundColor: '#202936' },
  summaryLabel: { fontSize: 12, color: '#CBD5E1' },
  summaryValue: { marginTop: 4, fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
});

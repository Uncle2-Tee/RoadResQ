import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, TextInput, View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { AppIcon } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { Drawer } from '../components/drawer';
import { FastPressable } from '../components/fast-pressable';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { cancelPaystackCheckout, getPayableRequests, startPaystackCheckout, verifyPaystackCheckout } from '../services/payment-receipt-recorder';
import type { RequestHistoryItem } from '../services/api-client';

const getPaymentErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback;
  if (message.includes('instead of JSON') || message.includes('Unexpected character')) {
    return 'The payment backend returned a web page instead of payment data. Check EXPO_PUBLIC_API_URL and make sure the Next backend is running on port 3000.';
  }

  return message;
};

export default function PaymentScreen() {
  const router = useRouter();
  const { requestId: requestIdParam } = useLocalSearchParams<{ requestId?: string }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [amount, setAmount] = useState('');
  const [activeReference, setActiveReference] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [payableRequests, setPayableRequests] = useState<RequestHistoryItem[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(requestIdParam || null);
  const [requestsLoading, setRequestsLoading] = useState(true);

  useEffect(() => {
    getPayableRequests()
      .then((requests) => {
        setPayableRequests(requests);
        if (requestIdParam && requests.some((request) => request.requestId === requestIdParam)) {
          setSelectedRequestId(requestIdParam);
        }
      })
      .catch(() => setPayableRequests([]))
      .finally(() => setRequestsLoading(false));
  }, [requestIdParam]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const handlePaystackPayment = useCallback(async () => {
    if (isProcessing) {
      return;
    }

    if (!selectedRequestId) {
      Alert.alert('Select a request', 'Choose the accepted mechanic or tow request you want to pay for.');
      return;
    }

    setIsProcessing(true);
    try {
      const checkout = await startPaystackCheckout(selectedRequestId, amount);
      setActiveReference(checkout.reference);
      setCheckoutUrl(checkout.authorizationUrl);
    } catch (error) {
      const message = getPaymentErrorMessage(error, 'Failed to open payment page. Please try again.');
      Alert.alert('Error', message);
      console.error('Payment error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [amount, isProcessing, selectedRequestId]);

  const selectedRequest = payableRequests.find((request) => request.requestId === selectedRequestId);

  const handleVerifyPayment = useCallback(async () => {
    if (!activeReference || isVerifying) {
      return;
    }

    setIsVerifying(true);
    try {
      const result = await verifyPaystackCheckout(activeReference);
      if (result.ok) {
        Alert.alert('Payment verified', 'Your payment has been recorded successfully.');
        setPayableRequests((current) => current.filter((request) => request.requestId !== result.payment.requestId));
        setSelectedRequestId(null);
        setAmount('');
        setActiveReference(null);
        router.push('/transaction-history');
      } else {
        Alert.alert('Payment not complete', 'Paystack has not confirmed this payment yet.');
      }
    } catch (error) {
      const message = getPaymentErrorMessage(error, 'Unable to verify payment.');
      Alert.alert('Verification failed', message);
    } finally {
      setIsVerifying(false);
    }
  }, [activeReference, isVerifying, router]);

  const openTransactionHistory = useCallback(() => {
    router.push('/transaction-history');
  }, [router]);

  const closeCheckout = useCallback(() => {
    if (!activeReference) {
      setCheckoutUrl(null);
      return;
    }
    Alert.alert('Cancel payment?', 'This checkout will be cancelled and you can try again.', [
      { text: 'Keep checkout', style: 'cancel' },
      {
        text: 'Cancel payment',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelPaystackCheckout(activeReference);
          } catch (error) {
            console.error('Payment cancellation failed:', error);
          } finally {
            setCheckoutUrl(null);
            setActiveReference(null);
          }
        },
      },
    ]);
  }, [activeReference]);

  if (checkoutUrl) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.checkoutHeader}>
          <FastPressable
            style={styles.closeCheckoutButton}
            onPress={closeCheckout}
            accessibilityRole="button"
            accessibilityLabel="Close payment checkout"
          >
            <AppIcon name="close" size={22} color="#333" />
          </FastPressable>
          <ThemedText type="title" style={styles.checkoutTitle}>Paystack Checkout</ThemedText>
        </View>
        <WebView
          source={{ uri: checkoutUrl }}
          style={styles.checkoutWebView}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.checkoutLoading}>
              <ActivityIndicator size="large" color="#FF8C42" />
              <ThemedText style={styles.checkoutLoadingText}>Loading secure checkout...</ThemedText>
            </View>
          )}
        />
        <View style={styles.checkoutActions}>
          <ThemedText style={styles.checkoutHint}>After completing payment, close checkout and verify your payment.</ThemedText>
          <FastPressable
            style={[styles.verifyButton, isVerifying && styles.mainButtonDisabled]}
            onPress={handleVerifyPayment}
            disabled={isVerifying}
            accessibilityRole="button"
            accessibilityLabel="Verify payment"
          >
            {isVerifying ? (
              <ActivityIndicator color="#FF8C42" size="small" />
            ) : (
              <ThemedText style={styles.verifyButtonText}>Verify Payment</ThemedText>
            )}
          </FastPressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerContainer}>
        <FastPressable
          style={styles.menuIcon}
          onPress={openDrawer}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <AppIcon name="menu" size={24} color="#333" />
        </FastPressable>
        <ThemedText type="title" style={styles.title}>Payment</ThemedText>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <View style={styles.heroSection}>
          <View style={styles.heroGradientBox}>
            <AppIcon name="creditCard" size={46} color="#fff" style={styles.heroIcon} />
            <ThemedText style={styles.heroTitle}>Secure Payment Gateway</ThemedText>
            <ThemedText style={styles.heroSubtitle}>Fast, Safe & Reliable Transactions</ThemedText>
          </View>
        </View>

        <View style={styles.requestSection}>
          <ThemedText style={styles.sectionTitle}>Select service request</ThemedText>
          {requestsLoading ? <ActivityIndicator color="#FF8C42" /> : payableRequests.length === 0 ? (
            <ThemedText style={styles.emptyRequestText}>No accepted mechanic or tow requests are ready for payment.</ThemedText>
          ) : payableRequests.map((request) => (
            <FastPressable
              key={request.requestId}
              style={[styles.requestCard, selectedRequestId === request.requestId && styles.requestCardSelected]}
              onPress={() => setSelectedRequestId(request.requestId)}
              accessibilityRole="button"
              accessibilityLabel={`Select ${request.type} request from ${request.providerName}`}
            >
              <View style={styles.requestCardHeader}>
                <ThemedText style={styles.requestProvider}>{request.providerName}</ThemedText>
                <ThemedText style={styles.requestAmount}>
                  {Number(request.price) > 0 ? `GHS ${Number(request.price).toFixed(2)}` : 'Amount required'}
                </ThemedText>
              </View>
              <ThemedText style={styles.requestDetail}>{request.type === 'tow' ? 'Towing request' : 'Mechanic service'}</ThemedText>
              <ThemedText style={styles.requestDetail}>{request.driverLocation || 'Location not provided'}</ThemedText>
              <ThemedText style={styles.requestId}>Request: {request.requestId}</ThemedText>
            </FastPressable>
          ))}
        </View>

        <View style={styles.ctaSection}>
          <TextInput
            style={styles.amountInput}
            value={Number(selectedRequest?.price) > 0 ? `GHS ${Number(selectedRequest?.price).toFixed(2)}` : amount}
            onChangeText={setAmount}
            editable={Boolean(selectedRequest && Number(selectedRequest.price) <= 0)}
            keyboardType="decimal-pad"
            placeholder={selectedRequest ? 'Enter agreed amount in GHS' : 'Select a request'}
            placeholderTextColor="#999"
          />
          <FastPressable
            style={[styles.mainButton, isProcessing && styles.mainButtonDisabled]}
            onPress={handlePaystackPayment}
            disabled={isProcessing}
            accessibilityRole="button"
            accessibilityLabel="Proceed to payment"
          >
            {isProcessing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <AppIcon name="creditCard" size={22} color="#fff" style={styles.mainButtonIcon} />
                <ThemedText style={styles.mainButtonText}>Proceed to Payment</ThemedText>
              </>
            )}
          </FastPressable>
          <ThemedText style={styles.disclaimerText}>
            Your payment information is encrypted and secure
          </ThemedText>
          {activeReference && (
            <FastPressable
              style={[styles.verifyButton, isVerifying && styles.mainButtonDisabled]}
              onPress={handleVerifyPayment}
              disabled={isVerifying}
              accessibilityRole="button"
              accessibilityLabel="Verify payment"
            >
              {isVerifying ? (
                <ActivityIndicator color="#FF8C42" size="small" />
              ) : (
                <ThemedText style={styles.verifyButtonText}>Verify Payment</ThemedText>
              )}
            </FastPressable>
          )}
        </View>

        <View style={styles.historySection}>
          <FastPressable
            style={styles.historyButton}
            onPress={openTransactionHistory}
            accessibilityRole="button"
            accessibilityLabel="View transaction history"
          >
            <AppIcon name="list" size={18} color="#FF8C42" style={styles.historyButtonIcon} />
            <ThemedText style={styles.historyButtonText}>View Transaction History</ThemedText>
          </FastPressable>
        </View>
      </ScrollView>

      <BottomNav showHome />
      <Drawer isOpen={drawerOpen} onClose={closeDrawer} role="driver" />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9ff',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  checkoutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  closeCheckoutButton: {
    padding: 8,
    marginRight: 12,
  },
  checkoutTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1a1a1a',
  },
  checkoutWebView: {
    flex: 1,
    backgroundColor: '#fff',
  },
  checkoutLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  checkoutLoadingText: {
    marginTop: 12,
    color: '#666',
  },
  checkoutActions: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    alignItems: 'center',
  },
  checkoutHint: {
    marginBottom: 10,
    textAlign: 'center',
    fontSize: 12,
    color: '#666',
  },
  menuIcon: {
    padding: 8,
    marginRight: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1a1a1a',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  contentInner: {
    paddingBottom: 92,
    justifyContent: 'flex-start',
  },
  heroSection: {
    marginBottom: 20,
  },
  heroGradientBox: {
    backgroundColor: '#FF8C42',
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#FF8C42',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 5,
  },
  heroIcon: {
    fontSize: 46,
    marginBottom: 10,
  },
  heroTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1a1a1a',
    marginBottom: 10,
  },
  requestSection: {
    marginBottom: 20,
  },
  emptyRequestText: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    color: '#777',
    textAlign: 'center',
  },
  requestCard: {
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  requestCardSelected: {
    borderColor: '#FF8C42',
    borderWidth: 2,
    backgroundColor: '#fff8f2',
  },
  requestCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  requestProvider: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#1a1a1a',
  },
  requestAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#C2410C',
  },
  requestDetail: {
    marginTop: 4,
    fontSize: 12,
    color: '#666',
  },
  requestId: {
    marginTop: 8,
    fontSize: 11,
    color: '#999',
  },
  ctaSection: {
    marginBottom: 18,
    alignItems: 'center',
  },
  mainButton: {
    backgroundColor: '#FF8C42',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF8C42',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
    width: '100%',
    maxWidth: 320,
  },
  mainButtonDisabled: {
    opacity: 0.7,
  },
  amountInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: '100%',
    maxWidth: 320,
    marginBottom: 12,
    fontSize: 15,
    color: '#222',
  },
  mainButtonIcon: {
    fontSize: 22,
    marginRight: 10,
  },
  mainButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  disclaimerText: {
    fontSize: 12,
    color: '#16a34a',
    textAlign: 'center',
    fontWeight: '600',
    marginTop: 8,
  },
  verifyButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FF8C42',
    paddingVertical: 12,
    paddingHorizontal: 32,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    marginTop: 12,
  },
  verifyButtonText: {
    color: '#FF8C42',
    fontSize: 15,
    fontWeight: '800',
  },
  historySection: {
    alignItems: 'center',
  },
  historyButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FF8C42',
    width: '100%',
    maxWidth: 320,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  historyButtonIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  historyButtonText: {
    color: '#FF8C42',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

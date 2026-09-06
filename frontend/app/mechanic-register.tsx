import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { AppIcon } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { createMechanicShop } from '../services/api-client';

const IS_IOS = Platform.OS === 'ios';
const PENDING_MECHANIC_SHOP_KEY = 'pendingMechanicShopId';

interface FormData {
  shopName: string;
  phone: string;
  location: string;
  specialization: string;
  licenseNumber: string;
}

const GHANA_CARD_NUMBER_PATTERN = /^GHA-\d{9}-\d$/;
const MAX_REGISTRATION_LOCATION_ACCURACY_METERS = 250;

export default function MechanicRegisterScreen() {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>({
    shopName: '',
    phone: '',
    location: '',
    specialization: '',
    licenseNumber: '',
  });
  const [focusedField, setFocusedField] = useState<keyof FormData | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (isMounted) {
            setLocationError('Location permission denied. Enable location before submitting.');
            setLocationLoading(false);
          }
          return;
        }

        const cachedLocation = await Location.getLastKnownPositionAsync({
          maxAge: 5 * 60 * 1000,
          requiredAccuracy: 5000,
        }).catch(() => null);

        if (
          cachedLocation &&
          isMounted &&
          cachedLocation.coords.accuracy !== null &&
          cachedLocation.coords.accuracy <= MAX_REGISTRATION_LOCATION_ACCURACY_METERS
        ) {
          setCoords({
            latitude: cachedLocation.coords.latitude,
            longitude: cachedLocation.coords.longitude,
          });
        }

        const liveLocation = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          }),
          new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), 6000);
          }),
        ]);

        if (!isMounted) {
          return;
        }

        if (
          liveLocation &&
          liveLocation.coords.accuracy !== null &&
          liveLocation.coords.accuracy <= MAX_REGISTRATION_LOCATION_ACCURACY_METERS
        ) {
          setCoords({
            latitude: liveLocation.coords.latitude,
            longitude: liveLocation.coords.longitude,
          });
          setLocationError(null);
        } else if (!cachedLocation || cachedLocation.coords.accuracy === null || cachedLocation.coords.accuracy > MAX_REGISTRATION_LOCATION_ACCURACY_METERS) {
          setLocationError('A precise location is required. Move outdoors or enable high-accuracy location and try again.');
        }
      } catch (error) {
        console.error('Error getting location:', error);
        if (isMounted) {
          setLocationError('Unable to fetch location. You can fill the form and try submitting again.');
        }
      } finally {
        if (isMounted) {
          setLocationLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleRegister = async () => {
    if (isSubmitting) {
      return;
    }

    const requiredFields: Array<{ field: keyof FormData; label: string }> = [
      { field: 'shopName', label: 'Shop Name' },
      { field: 'phone', label: 'Phone Number' },
      { field: 'location', label: 'Location / City' },
      { field: 'specialization', label: 'Specialization' },
      { field: 'licenseNumber', label: 'Ghana Card Number' },
    ];
    const emptyFields = requiredFields.filter(({ field }) => !formData[field].trim());

    if (emptyFields.length > 0) {
      Alert.alert('Missing field', `Please fill: ${emptyFields.map(({ label }) => label).join(', ')}`);
      return;
    }

    if (!GHANA_CARD_NUMBER_PATTERN.test(formData.licenseNumber.trim().toUpperCase())) {
      Alert.alert('Invalid Ghana Card number', 'Enter your Ghana Card number as GHA-123456789-0.');
      return;
    }

    if (!coords) {
      Alert.alert(
        'Location not ready',
        locationLoading
          ? 'The app is still getting your location. Please wait a moment and submit again.'
          : locationError || 'Location data is not available. Please enable location services.'
      );
      return;
    }

    try {
      setIsSubmitting(true);
      const shopId = `shop-${Date.now()}`;
      const mechanicId = await AsyncStorage.getItem('userId');
      const savedShop = await createMechanicShop({
        shopId,
        mechanicId,
        shopName: formData.shopName.trim(),
        phone: formData.phone.trim(),
        latitude: coords.latitude,
        longitude: coords.longitude,
        location: formData.location.trim(),
        specialization: formData.specialization.trim(),
        licenseNumber: formData.licenseNumber.trim().toUpperCase(),
        providerType: 'registered',
        status: 'active',
      });
      await AsyncStorage.setItem(PENDING_MECHANIC_SHOP_KEY, savedShop.shopId);

      // Create shop object with actual coordinates from device location
      const newShop = {
        id: savedShop.shopId,
        mechanicId,
        name: savedShop.shopName,
        phone: savedShop.phone,
        latitude: savedShop.latitude,
        longitude: savedShop.longitude,
        location: savedShop.location,
        specialization: savedShop.specialization,
        licenseNumber: savedShop.licenseNumber,
        providerType: 'registered' as const,
      };

      // Get existing shops from AsyncStorage
      const existingShopsJson = await AsyncStorage.getItem('registeredShops');
      const existingShops = existingShopsJson ? JSON.parse(existingShopsJson) : [];

      // Add new shop
      const updatedShops = [
        ...existingShops.filter((shop: typeof newShop) => shop.licenseNumber !== newShop.licenseNumber),
        newShop,
      ];

      // Save back to AsyncStorage
      await AsyncStorage.setItem('registeredShops', JSON.stringify(updatedShops));

      Alert.alert(
        'Registration Submitted',
        'Your shop registration is pending admin approval. You will receive a success message after it is approved.',
        [
          {
            text: 'OK',
            onPress: () => {
              router.push('/mechanic-dashboard');
            }
          }
        ]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to register shop. Please try again.';
      Alert.alert('Error', message);
      console.error('Registration error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderInputField = (
    label: string,
    field: keyof FormData,
    placeholder: string,
    keyboardType: 'default' | 'phone-pad' | 'email-address' = 'default',
    secureTextEntry: boolean = false,
    showPasswordToggle?: { isVisible: boolean; toggle: () => void }
  ) => (
    <View style={styles.formGroup}>
      <ThemedText style={styles.fieldLabel}>{label}</ThemedText>
      <View style={[styles.inputWrapper, focusedField === field && styles.inputWrapperFocused]}>
        <TextInput
          style={[styles.input, showPasswordToggle && styles.inputWithIcon]}
          placeholder={placeholder}
          value={formData[field]}
          onChangeText={(value) => handleInputChange(field, value)}
          onFocus={() => setFocusedField(field)}
          onBlur={() => setFocusedField(null)}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry && !showPasswordToggle?.isVisible}
          autoCapitalize={field === 'licenseNumber' ? 'characters' : 'sentences'}
          placeholderTextColor="#999"
        />
        {showPasswordToggle && (
          <TouchableOpacity 
            style={styles.eyeIconButton}
            onPress={showPasswordToggle.toggle}
            activeOpacity={0.7}
          >
            <AppIcon name={showPasswordToggle.isVisible ? 'eyeOff' : 'eye'} size={20} color="#666" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <Image source={require('../assets/images/shit.png')} style={styles.headerIcon} />
        <ThemedText style={styles.headerTitle}>Shop Registration</ThemedText>
        <ThemedText style={styles.headerSubtitle}>Join our network of certified shops</ThemedText>
      </View>

      <ScrollView 
        style={styles.scrollContainer} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
            <View
              style={[
                styles.locationStatus,
                coords && styles.locationStatusReady,
                locationError && !coords && styles.locationStatusError,
              ]}
            >
              <AppIcon
                name={locationError && !coords ? 'alert' : 'mapPin'}
                size={18}
                color={locationError && !coords ? '#d32f2f' : coords ? '#15803d' : '#FF8C42'}
              />
              <ThemedText
                style={[
                  styles.locationStatusText,
                  coords && styles.locationStatusTextReady,
                  locationError && !coords && styles.locationStatusTextError,
                ]}
              >
                {coords
                  ? 'Location ready'
                  : locationLoading
                    ? 'Getting your location in the background...'
                    : locationError || 'Location required before submitting'}
              </ThemedText>
            </View>

            {/* Basic Information Section */}
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Business Information</ThemedText>
              {renderInputField('Shop Name', 'shopName', 'Enter your shop name')}
              {renderInputField('Phone Number', 'phone', 'e.g., 0541234567', 'phone-pad')}
              {renderInputField('Location / City', 'location', 'Enter your shop location')}
            </View>

            {/* Specialization & License Section */}
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Credentials</ThemedText>
              {renderInputField('Specialization', 'specialization', 'e.g., Engine, Brakes, Electrical')}
              {renderInputField('Ghana Card Number', 'licenseNumber', 'GHA-123456789-0')}
            </View>

            {/* Register Button */}
            <View style={styles.buttonSection}>
              <TouchableOpacity
                style={[styles.registerButton, isSubmitting && styles.registerButtonDisabled]}
                onPress={handleRegister}
                activeOpacity={0.8}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={styles.buttonText}>Complete Registration</ThemedText>
                )}
              </TouchableOpacity>
              <ThemedText style={styles.helperText}>All fields are required</ThemedText>
            </View>
      </ScrollView>

      <BottomNav 
        onHomePress={() => router.push('/mechanic-dashboard')} 
        showHome={true}
      />
    </ThemedView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  headerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: IS_IOS ? 36 : 32,
    paddingTop: IS_IOS ? 58 : 50,
    backgroundColor: '#fff',
    borderBottomWidth: 2,
    borderBottomColor: '#FF8C42',
  },
  headerIcon: {
    width: IS_IOS ? 88 : 80,
    height: IS_IOS ? 88 : 80,
    marginBottom: 12,
    resizeMode: 'contain',
  },
  headerTitle: {
    fontSize: IS_IOS ? 30 : 28,
    lineHeight: IS_IOS ? 38 : 36,
    fontWeight: '800',
    color: '#333',
    marginBottom: 8,
    paddingHorizontal: 18,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: IS_IOS ? 15 : 14,
    color: '#666',
    textAlign: 'center',
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#f8f9fa',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d32f2f',
    textAlign: 'center',
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: IS_IOS ? 22 : 20,
    paddingVertical: IS_IOS ? 26 : 24,
    paddingBottom: 120,
  },
  locationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: IS_IOS ? 12 : 10,
    marginBottom: 16,
  },
  locationStatusReady: {
    backgroundColor: '#ECFDF3',
    borderColor: '#BBF7D0',
  },
  locationStatusError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  locationStatusText: {
    flex: 1,
    fontSize: IS_IOS ? 13 : 12,
    fontWeight: '600',
    color: '#B45309',
  },
  locationStatusTextReady: {
    color: '#15803d',
  },
  locationStatusTextError: {
    color: '#d32f2f',
  },
  section: {
    marginBottom: IS_IOS ? 30 : 28,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: IS_IOS ? 22 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: IS_IOS ? 17 : 16,
    fontWeight: '700',
    color: '#FF8C42',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#FFE0CC',
  },
  formGroup: {
    marginBottom: 18,
  },
  fieldLabel: {
    fontSize: IS_IOS ? 14 : 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  inputWrapper: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  inputWrapperFocused: {
    borderColor: '#FF8C42',
    shadowColor: '#FF8C42',
    shadowOpacity: 0.15,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: IS_IOS ? 16 : 14,
    fontSize: IS_IOS ? 16 : 15,
    color: '#333',
  },
  inputWithIcon: {
    paddingRight: 50,
  },
  eyeIconButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  eyeIcon: {
    fontSize: 20,
  },
  buttonSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  registerButton: {
    backgroundColor: '#FF8C42',
    paddingVertical: IS_IOS ? 18 : 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    width: '100%',
    maxWidth: IS_IOS ? 340 : 300,
    minHeight: IS_IOS ? 56 : undefined,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF8C42',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
    marginBottom: 12,
  },
  registerButtonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: IS_IOS ? 17 : 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  helperText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    fontWeight: '500',
  },
  payoutHint: {
    fontSize: 12,
    color: '#777',
    lineHeight: 18,
    marginTop: -4,
  },
});

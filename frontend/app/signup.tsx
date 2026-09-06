import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ActivityIndicator, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppIcon } from '../components/app-icon';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { login, signup } from '../services/api-client';

const DRIVER_NAME_KEY = 'driverName';
const DRIVER_PHONE_KEY = 'driverPhone';
const CURRENT_USER_EMAIL_KEY = 'currentUserEmail';
const USER_ROLE_KEY = 'userRole';
const LAST_AUTHENTICATED_ROLE_KEY = 'lastAuthenticatedRole';
const LAST_MECHANIC_ID_KEY = 'lastAuthenticatedMechanicId';
const LAST_MECHANIC_NAME_KEY = 'lastAuthenticatedMechanicName';
const USER_ID_KEY = 'userId';
const USER_SESSION_ID_KEY = 'userSessionId';
const MECHANIC_NAME_KEY = 'mechanicName';
const TOWER_NAME_KEY = 'towerName';
const IS_IOS = Platform.OS === 'ios';

type UserRole = 'driver' | 'mechanic' | 'tower';

export default function SignupScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const normalizeEmail = (value: string) => value.trim().toLowerCase();

  const validateLettersOnly = (text: string) => {
    // Allow only letters and spaces
    return text.replace(/[^a-zA-Z\s]/g, '');
  };

  const validateNumbersOnly = (text: string) => {
    // Allow only numbers
    return text.replace(/[^0-9]/g, '');
  };

  const selectedRoleLabel =
    userRole === 'driver'
      ? 'Driver'
      : userRole === 'mechanic'
        ? 'Mechanic'
        : userRole === 'tower'
          ? 'Tow Provider'
          : 'Choose a role';
  const selectedRoleSubtitle =
    userRole === 'driver'
      ? 'Request roadside assistance'
      : userRole === 'mechanic'
        ? 'Receive and manage service jobs'
        : userRole === 'tower'
          ? 'Register your towing company'
        : 'Select how you want to use the app';

  const handleRoleSelect = (role: UserRole) => {
    setUserRole(role);
    setRoleDropdownOpen(false);
  };

  const handleSignup = async () => {
    const missingFields = [
      { label: 'Full Name', value: fullName },
      { label: 'Email', value: email },
      { label: 'Phone Number', value: phone },
      { label: 'Password', value: password },
      { label: 'Confirm Password', value: confirmPassword },
    ].filter((field) => !field.value.trim());

    if (missingFields.length > 0) {
      Alert.alert('Missing field', `Please fill: ${missingFields.map((field) => field.label).join(', ')}`);
      return;
    }

    if (!userRole) {
      Alert.alert('Missing field', 'Please select: Role');
      return;
    }

    const normalizedEmail = normalizeEmail(email);

    if (!validateEmail(normalizedEmail)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    try {
      // Call signup API
      await signup({
        fullName: fullName.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        password: password.trim(),
        confirmPassword: confirmPassword.trim(),
        role: userRole,
      });

      const user = await login({
        email: normalizedEmail,
        password: password.trim(),
      });

      // Store user data locally
      const storageItems: [string, string][] = [
        [USER_ID_KEY, user.id],
        [DRIVER_NAME_KEY, user.name],
        [DRIVER_PHONE_KEY, user.phone || ''],
        [CURRENT_USER_EMAIL_KEY, user.email],
        [USER_ROLE_KEY, user.role],
        [LAST_AUTHENTICATED_ROLE_KEY, user.role],
      ];

      if (user.sessionId) {
        storageItems.push([USER_SESSION_ID_KEY, user.sessionId]);
      }

      if (user.role === 'mechanic') {
        storageItems.push([MECHANIC_NAME_KEY, user.name]);
        storageItems.push([LAST_MECHANIC_ID_KEY, user.id]);
        storageItems.push([LAST_MECHANIC_NAME_KEY, user.name]);
      } else if (user.role === 'tower') {
        storageItems.push([TOWER_NAME_KEY, user.name]);
      }

      if (user.profilePhotoUri) {
        storageItems.push(['driverProfilePhotoUri', user.profilePhotoUri]);
      }

      await AsyncStorage.multiSet(storageItems);

      // Request location permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Location permission denied');
      } else {
        console.log('Location permission granted');
      }

      // Clear form fields
      setFullName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setConfirmPassword('');
      setUserRole(null);

      Alert.alert('Success', 'Account created successfully!');
      if (user.role === 'mechanic') {
        router.replace({
          pathname: '/mechanic-dashboard',
          params: { mechanicName: user.name },
        } as any);
      } else if (user.role === 'tower') {
        router.replace({
          pathname: '/tower-dashboard',
          params: { towerName: user.name },
        } as any);
      } else {
        router.replace({
          pathname: '/driver-dashboard',
          params: { driverName: user.name },
        } as any);
      }
    } catch (error) {
      console.error('Signup error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unable to create account';
      Alert.alert('Error', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.gradient}>
      <LinearGradient
        colors={['#FFEBD0', '#FFD9B5']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientContainer}
      >
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.formCard}>
            <ThemedText style={styles.title}>Create Account</ThemedText>

            <ThemedText style={styles.inputLabel}>Full Name</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="e.g., Elliot Fiawornu"
              value={fullName}
              onChangeText={(text) => setFullName(validateLettersOnly(text))}
              placeholderTextColor="#999"
            />

            <ThemedText style={styles.inputLabel}>Email</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="e.g., elliot@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor="#999"
            />

            <ThemedText style={styles.inputLabel}>Phone Number</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="e.g., 0123456789"
              value={phone}
              onChangeText={(text) => setPhone(validateNumbersOnly(text))}
              keyboardType="phone-pad"
              placeholderTextColor="#999"
            />

            <ThemedText style={styles.roleLabel}>Select Your Role *</ThemedText>
            <View style={styles.roleDropdownWrap}>
              <TouchableOpacity
                style={[
                  styles.roleSelectButton,
                  roleDropdownOpen && styles.roleSelectButtonOpen,
                  userRole && styles.roleSelectButtonSelected,
                ]}
                onPress={() => setRoleDropdownOpen((open) => !open)}
                activeOpacity={0.85}
              >
                <View style={[styles.roleIconWrap, userRole && styles.roleIconWrapSelected]}>
                  <AppIcon
                    name={userRole === 'mechanic' ? 'wrench' : userRole === 'tower' ? 'store' : 'car'}
                    size={20}
                    color={userRole ? '#fff' : '#FF8C42'}
                  />
                </View>
                <View style={styles.roleOptionText}>
                  <ThemedText style={[styles.roleOptionTitle, !userRole && styles.rolePlaceholderText]}>
                    {selectedRoleLabel}
                  </ThemedText>
                  <ThemedText style={styles.roleOptionSubtitle}>{selectedRoleSubtitle}</ThemedText>
                </View>
                <AppIcon
                  name={roleDropdownOpen ? 'chevronUp' : 'chevronDown'}
                  size={24}
                  color="#666"
                />
              </TouchableOpacity>

              {roleDropdownOpen && (
                <View style={styles.roleDropdownMenu}>
                  <TouchableOpacity
                    style={[
                      styles.roleDropdownOption,
                      userRole === 'driver' && styles.roleDropdownOptionSelected,
                    ]}
                    onPress={() => handleRoleSelect('driver')}
                    activeOpacity={0.85}
                  >
                    <View style={[
                      styles.roleIconWrap,
                      userRole === 'driver' && styles.roleIconWrapSelected,
                    ]}>
                      <AppIcon
                        name="car"
                        size={20}
                        color={userRole === 'driver' ? '#fff' : '#FF8C42'}
                      />
                    </View>
                    <View style={styles.roleOptionText}>
                      <ThemedText style={styles.roleOptionTitle}>Driver</ThemedText>
                      <ThemedText style={styles.roleOptionSubtitle}>Request roadside assistance</ThemedText>
                    </View>
                    {userRole === 'driver' && <AppIcon name="check" size={20} color="#FF8C42" />}
                  </TouchableOpacity>

                  <View style={styles.roleDropdownDivider} />

                  <TouchableOpacity
                    style={[
                      styles.roleDropdownOption,
                      userRole === 'mechanic' && styles.roleDropdownOptionSelected,
                    ]}
                    onPress={() => handleRoleSelect('mechanic')}
                    activeOpacity={0.85}
                  >
                    <View style={[
                      styles.roleIconWrap,
                      userRole === 'mechanic' && styles.roleIconWrapSelected,
                    ]}>
                      <AppIcon
                        name="wrench"
                        size={20}
                        color={userRole === 'mechanic' ? '#fff' : '#FF8C42'}
                      />
                    </View>
                    <View style={styles.roleOptionText}>
                      <ThemedText style={styles.roleOptionTitle}>Mechanic</ThemedText>
                      <ThemedText style={styles.roleOptionSubtitle}>Receive and manage service jobs</ThemedText>
                    </View>
                    {userRole === 'mechanic' && <AppIcon name="check" size={20} color="#FF8C42" />}
                  </TouchableOpacity>

                  <View style={styles.roleDropdownDivider} />

                  <TouchableOpacity
                    style={[
                      styles.roleDropdownOption,
                      userRole === 'tower' && styles.roleDropdownOptionSelected,
                    ]}
                    onPress={() => handleRoleSelect('tower')}
                    activeOpacity={0.85}
                  >
                    <View style={[
                      styles.roleIconWrap,
                      userRole === 'tower' && styles.roleIconWrapSelected,
                    ]}>
                      <AppIcon
                        name="store"
                        size={20}
                        color={userRole === 'tower' ? '#fff' : '#FF8C42'}
                      />
                    </View>
                    <View style={styles.roleOptionText}>
                      <ThemedText style={styles.roleOptionTitle}>Tow Provider</ThemedText>
                      <ThemedText style={styles.roleOptionSubtitle}>Register your towing company</ThemedText>
                    </View>
                    {userRole === 'tower' && <AppIcon name="check" size={20} color="#FF8C42" />}
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <ThemedText style={styles.inputLabel}>Password</ThemedText>
            <View style={styles.inputWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholderTextColor="#999"
              />
              <TouchableOpacity
                style={styles.passwordToggle}
                onPress={() => setShowPassword((s) => !s)}
              >
                <AppIcon name={showPassword ? 'eyeOff' : 'eye'} size={20} color="#666" />
              </TouchableOpacity>
            </View>

            <ThemedText style={styles.inputLabel}>Confirm Password</ThemedText>
            <View style={styles.inputWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder="Confirm password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                placeholderTextColor="#999"
              />
              <TouchableOpacity
                style={styles.passwordToggle}
                onPress={() => setShowConfirmPassword((s) => !s)}
              >
                <AppIcon name={showConfirmPassword ? 'eyeOff' : 'eye'} size={20} color="#666" />
              </TouchableOpacity>
            </View>

            <LinearGradient
              colors={['#FF8C42', '#FF7B2B']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.buttonGradient}
            >
              <TouchableOpacity 
                style={styles.createButton} 
                onPress={handleSignup}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <ThemedText style={styles.buttonText}>Create Account</ThemedText>
                )}
              </TouchableOpacity>
            </LinearGradient>

            <View style={styles.linkContainer}>
              <ThemedText style={styles.linkText}>Already have an account? </ThemedText>
              <Link href="/login">
                <ThemedText style={styles.linkHighlight}>Login</ThemedText>
              </Link>
            </View>
          </View>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  gradientContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  scrollView: {
    width: '100%',
  },
  scrollContent: {
    width: '100%',
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingTop: 12,
  },
  formCard: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: IS_IOS ? 18 : 16,
    padding: IS_IOS ? 18 : 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: IS_IOS ? 24 : 22,
    fontWeight: '800',
    color: '#333',
    marginBottom: 2,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: IS_IOS ? 14 : 13,
    color: '#888',
    textAlign: 'center',
    marginBottom: 12,
    fontWeight: '500',
  },
  input: {
    width: '100%',
    height: IS_IOS ? 46 : 40,
    borderRadius: 10,
    marginBottom: IS_IOS ? 8 : 6,
    paddingHorizontal: 16,
    paddingVertical: IS_IOS ? 8 : 6,
    backgroundColor: '#f5f5f5',
    fontSize: IS_IOS ? 16 : 15,
    color: '#333',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    textAlignVertical: 'top',
  },
  inputLabel: {
    fontSize: IS_IOS ? 14 : 13,
    fontWeight: '700',
    color: '#333',
    marginBottom: 3,
  },
  roleLabel: {
    fontSize: IS_IOS ? 15 : 14,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
    marginTop: 2,
  },
  roleDropdownWrap: {
    width: '100%',
    marginBottom: 8,
    position: 'relative',
  },
  roleSelectButton: {
    minHeight: IS_IOS ? 64 : 58,
    borderRadius: 12,
    backgroundColor: '#f8f8f8',
    borderWidth: 1,
    borderColor: '#e4e4e4',
    paddingHorizontal: 12,
    paddingVertical: IS_IOS ? 12 : 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  roleSelectButtonOpen: {
    borderColor: '#FF8C42',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  roleSelectButtonSelected: {
    backgroundColor: '#FFF3E8',
    borderColor: '#FF8C42',
  },
  roleDropdownMenu: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFD9B5',
    marginTop: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },
  roleDropdownOption: {
    minHeight: IS_IOS ? 68 : 62,
    paddingHorizontal: 12,
    paddingVertical: IS_IOS ? 13 : 11,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  roleDropdownOptionSelected: {
    backgroundColor: '#FFF7EF',
  },
  roleDropdownDivider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginLeft: 58,
  },
  roleIconWrap: {
    width: IS_IOS ? 40 : 36,
    height: IS_IOS ? 40 : 36,
    borderRadius: IS_IOS ? 20 : 18,
    backgroundColor: '#FFF3E0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  roleIconWrapSelected: {
    backgroundColor: '#FF8C42',
  },
  roleOptionText: {
    flex: 1,
    minWidth: 0,
  },
  roleOptionTitle: {
    fontSize: IS_IOS ? 14 : 13,
    fontWeight: '800',
    color: '#333',
    marginBottom: 2,
  },
  rolePlaceholderText: {
    color: '#666',
  },
  roleOptionSubtitle: {
    fontSize: IS_IOS ? 11 : 10,
    fontWeight: '600',
    color: '#777',
  },
  buttonGradient: {
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  createButton: {
    paddingVertical: IS_IOS ? 14 : 11,
    minHeight: IS_IOS ? 52 : undefined,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: IS_IOS ? 17 : 16,
    fontWeight: '700',
  },
  linkContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  linkText: {
    fontSize: 14,
    color: '#666',
  },
  linkHighlight: {
    fontSize: 14,
    color: '#FF8C42',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  inputWrapper: {
    width: '100%',
    position: 'relative',
    marginBottom: 6,
  },
  passwordToggle: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  passwordInput: {
    paddingRight: 48,
    marginBottom: 0,
  },
});

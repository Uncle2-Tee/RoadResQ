import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import LocalAuthentication from 'expo-local-authentication';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon } from '../components/app-icon';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { login, resetPassword, sendPasswordReset } from '../services/api-client';
import { registerProviderPushTokenIfNeeded } from '../services/push-notifications';

// @ts-ignore
const logoImage = require('@/assets/images/a.png');

interface LoginScreenProps {
  onLogin: (userName: string, userRole: string) => void;
}

const DRIVER_NAME_KEY = 'driverName';
const DRIVER_PHONE_KEY = 'driverPhone';
const MECHANIC_NAME_KEY = 'mechanicName';
const TOWER_NAME_KEY = 'towerName';
const CURRENT_USER_EMAIL_KEY = 'currentUserEmail';
const USER_ROLE_KEY = 'userRole';
const LAST_AUTHENTICATED_ROLE_KEY = 'lastAuthenticatedRole';
const LAST_MECHANIC_ID_KEY = 'lastAuthenticatedMechanicId';
const LAST_MECHANIC_NAME_KEY = 'lastAuthenticatedMechanicName';
const USER_ID_KEY = 'userId';
const USER_SESSION_ID_KEY = 'userSessionId';
type AuthMode = 'login' | 'forgot' | 'reset';

const getResetSecondsRemaining = (expiresAt?: string | null) => {
  if (!expiresAt) {
    return null;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return null;
  }

  return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
};

const formatResetCountdown = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [issuedResetCode, setIssuedResetCode] = useState<string | null>(null);
  const [resetExpiresAt, setResetExpiresAt] = useState<string | null>(null);
  const [resetSecondsRemaining, setResetSecondsRemaining] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [isResetLoading, setIsResetLoading] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState<'checking' | 'ready' | 'unsupported' | 'not-enrolled'>('checking');
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);

  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const resetCodeExpired =
    authMode === 'reset' && resetSecondsRemaining !== null && resetSecondsRemaining <= 0;

  const continueSavedSession = useCallback(async () => {
    const [savedUserId, savedRole, savedDriverName, savedMechanicName, savedTowerName] = await Promise.all([
      AsyncStorage.getItem(USER_ID_KEY),
      AsyncStorage.getItem(USER_ROLE_KEY),
      AsyncStorage.getItem(DRIVER_NAME_KEY),
      AsyncStorage.getItem(MECHANIC_NAME_KEY),
      AsyncStorage.getItem(TOWER_NAME_KEY),
    ]);

    if (!savedUserId || !savedRole) {
      Alert.alert('No saved session', 'Please sign in with your email and password once before using fingerprint login.');
      return false;
    }

    onLogin(
      savedRole === 'admin'
        ? savedDriverName || 'Admin'
        : savedRole === 'mechanic'
        ? savedMechanicName || savedDriverName || 'Mechanic'
        : savedRole === 'tower'
          ? savedTowerName || savedDriverName || 'Tow Provider'
          : savedDriverName || 'Driver',
      savedRole
    );

    return true;
  }, [onLogin]);

  useEffect(() => {
    let isMounted = true;

    const checkBiometrics = async () => {
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        if (!isMounted) {
          return;
        }

        if (!hasHardware) {
          setBiometricStatus('unsupported');
          return;
        }

        setBiometricStatus(isEnrolled ? 'ready' : 'not-enrolled');
      } catch (error) {
        console.warn('Unable to inspect biometric support:', error);
        if (isMounted) {
          setBiometricStatus('unsupported');
        }
      }
    };

    checkBiometrics();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (authMode !== 'reset' || !resetExpiresAt) {
      setResetSecondsRemaining(null);
      return;
    }

    const updateCountdown = () => {
      setResetSecondsRemaining(getResetSecondsRemaining(resetExpiresAt));
    };

    updateCountdown();
    const intervalId = setInterval(updateCountdown, 1000);

    return () => clearInterval(intervalId);
  }, [authMode, resetExpiresAt]);

  const openForgotPassword = () => {
    setResetEmail(email);
    setResetCode('');
    setIssuedResetCode(null);
    setResetExpiresAt(null);
    setResetSecondsRemaining(null);
    setNewPassword('');
    setConfirmNewPassword('');
    setAuthMode('forgot');
  };

  const returnToLogin = () => {
    setAuthMode('login');
    setIsResetLoading(false);
    setResetSecondsRemaining(null);
  };

  const handleSendResetCode = async () => {
    if (isResetLoading) {
      return;
    }

    const enteredEmail = normalizeEmail(resetEmail);
    if (!enteredEmail) {
      Alert.alert('Missing field', 'Please enter your email address.');
      return;
    }

    try {
      setIsResetLoading(true);
      const result = await sendPasswordReset(enteredEmail);
      if (!result.ok) {
        Alert.alert('Error', result.message || 'Unable to create reset code.');
        return;
      }

      if (!result.resetCode) {
        Alert.alert('Reset code', result.message || 'If this email is registered, a reset code has been created.');
        return;
      }

      setResetEmail(enteredEmail);
      setIssuedResetCode(result.resetCode || null);
      setResetExpiresAt(result.expiresAt || null);
      setResetSecondsRemaining(getResetSecondsRemaining(result.expiresAt || null));
      setResetCode(result.resetCode || '');
      setAuthMode('reset');
      Alert.alert('Reset code created', result.message || 'Enter the reset code and your new password.');
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (isResetLoading) {
      return;
    }

    const missingFields = [
      { label: 'Reset code', value: resetCode },
      { label: 'New password', value: newPassword },
      { label: 'Confirm password', value: confirmNewPassword },
    ].filter((field) => !field.value.trim());

    if (missingFields.length > 0) {
      Alert.alert('Missing field', `Please fill: ${missingFields.map((field) => field.label).join(', ')}`);
      return;
    }

    if (newPassword !== confirmNewPassword) {
      Alert.alert('Password mismatch', 'New password and confirm password must match.');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }

    if (getResetSecondsRemaining(resetExpiresAt) === 0) {
      Alert.alert('Code expired', 'This reset code has expired. Please create a new code.');
      return;
    }

    try {
      setIsResetLoading(true);
      const result = await resetPassword({
        email: normalizeEmail(resetEmail),
        token: resetCode,
        newPassword,
        confirmPassword: confirmNewPassword,
      });

      if (!result.ok) {
        Alert.alert('Error', result.message || 'Unable to reset password.');
        return;
      }

      setEmail(normalizeEmail(resetEmail));
      setPassword('');
      setResetCode('');
      setIssuedResetCode(null);
      setResetExpiresAt(null);
      setResetSecondsRemaining(null);
      setNewPassword('');
      setConfirmNewPassword('');
      setAuthMode('login');
      Alert.alert('Password reset', result.message || 'You can now login with your new password.');
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (isBiometricLoading || biometricStatus !== 'ready') {
      return;
    }

    try {
      setIsBiometricLoading(true);
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock RoadResQ',
        fallbackLabel: 'Use passcode',
        cancelLabel: 'Cancel',
      });

      if (!result.success) {
        if (result.error) {
          Alert.alert('Fingerprint not available', result.error === 'user_cancel' ? 'Biometric login was cancelled.' : 'Fingerprint sign-in could not be completed.');
        }
        return;
      }

      await continueSavedSession();
    } catch (error) {
      console.error('Biometric login error:', error);
      Alert.alert('Fingerprint login failed', 'Please try again or use your email and password instead.');
    } finally {
      setIsBiometricLoading(false);
    }
  };

  const handleLogin = async (forceLogin = false) => {
    if (isLoading) {
      return;
    }

    const missingFields = [
      { label: 'Email', value: email },
      { label: 'Password', value: password },
    ].filter((field) => !field.value.trim());

    if (missingFields.length > 0) {
      Alert.alert('Missing field', `Please fill: ${missingFields.map((field) => field.label).join(', ')}`);
      return;
    }

    try {
      setIsLoading(true);
      const enteredEmail = normalizeEmail(email);

      const user = await login({
        email: enteredEmail,
        password,
        forceLogin,
      });

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

      if (user.profilePhotoUri) {
        storageItems.push(['driverProfilePhotoUri', user.profilePhotoUri]);
      }

      if (user.role === 'mechanic') {
        storageItems.push([MECHANIC_NAME_KEY, user.name]);
        storageItems.push([LAST_MECHANIC_ID_KEY, user.id]);
        storageItems.push([LAST_MECHANIC_NAME_KEY, user.name]);
      } else if (user.role === 'tower') {
        storageItems.push([TOWER_NAME_KEY, user.name]);
      }

      await AsyncStorage.multiSet(storageItems);
      if (user.role === 'mechanic' || user.role === 'tower') {
        registerProviderPushTokenIfNeeded(user.id, user.role).catch((error) => {
          console.warn('Unable to enable request notifications:', error);
        });
      }
      onLogin(user.name, user.role);
    } catch (error) {
      console.error('Login error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unable to login. Please try again.';
      if (!forceLogin && errorMessage.includes('already logged in on another device')) {
        Alert.alert(
          'Account active elsewhere',
          'This account is still marked as logged in on another device. Continue here and log out the other session?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Continue here',
              onPress: () => {
                handleLogin(true);
              },
            },
          ]
        );
        return;
      }

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
            <Image
              source={logoImage}
              style={styles.logo}
            />
            {authMode === 'login' ? (
              <>
                <ThemedText style={styles.title}>Welcome Back</ThemedText>
                <ThemedText style={styles.subtitle}>Sign in to your account</ThemedText>

                <ThemedText style={styles.inputLabel}>Email</ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="elliot@example.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor="#999"
                />

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

                <View style={styles.resetActionRow}>
                  <TouchableOpacity style={styles.resetActionButton} onPress={openForgotPassword}>
                    <ThemedText style={styles.resetActionText}>Forgot password?</ThemedText>
                  </TouchableOpacity>
                </View>

                <LinearGradient
                  colors={['#FF8C42', '#FF7B2B']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.buttonGradient}
                >
                  <TouchableOpacity
                    style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
                    onPress={() => handleLogin()}
                    disabled={isLoading}
                    accessibilityState={{ disabled: isLoading, busy: isLoading }}
                  >
                    {isLoading ? (
                      <View style={styles.loadingContent}>
                        <ActivityIndicator color="#fff" size="small" />
                        <ThemedText style={styles.buttonText}>Logging in...</ThemedText>
                      </View>
                    ) : (
                      <ThemedText style={styles.buttonText}>Login</ThemedText>
                    )}
                  </TouchableOpacity>
                </LinearGradient>

                <View style={styles.linkContainer}>
                  <ThemedText style={styles.linkText}>Don&apos;t have an account? </ThemedText>
                  <Link href="/signup">
                    <ThemedText style={styles.linkHighlight}>Sign Up</ThemedText>
                  </Link>
                </View>
              </>
            ) : (
              <>
                <View style={styles.resetHeaderIcon}>
                  <AppIcon name="timer" size={24} color="#FF8C42" />
                </View>
                <ThemedText style={styles.title}>Reset Password</ThemedText>
                <ThemedText style={styles.subtitle}>
                  {authMode === 'forgot'
                    ? 'Enter your email to create an in-app reset code'
                    : 'Enter the code and choose a new password'}
                </ThemedText>

                <View style={styles.resetStepRow}>
                  <View style={[styles.resetStepBadge, styles.resetStepBadgeActive]}>
                    <ThemedText style={styles.resetStepBadgeText}>1</ThemedText>
                  </View>
                  <View style={[styles.resetStepLine, authMode === 'reset' && styles.resetStepLineActive]} />
                  <View style={[styles.resetStepBadge, authMode === 'reset' && styles.resetStepBadgeActive]}>
                    <ThemedText style={[styles.resetStepBadgeText, authMode !== 'reset' && styles.resetStepBadgeTextMuted]}>
                      2
                    </ThemedText>
                  </View>
                </View>

                <ThemedText style={styles.inputLabel}>Account Email</ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="elliot@example.com"
                  value={resetEmail}
                  onChangeText={setResetEmail}
                  editable={authMode === 'forgot'}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor="#999"
                />

                {authMode === 'forgot' ? (
                  <LinearGradient
                    colors={['#FF8C42', '#FF7B2B']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.buttonGradient}
                  >
                    <TouchableOpacity
                      style={[styles.loginButton, isResetLoading && styles.loginButtonDisabled]}
                      onPress={handleSendResetCode}
                      disabled={isResetLoading}
                    >
                      {isResetLoading ? (
                        <View style={styles.loadingContent}>
                          <ActivityIndicator color="#fff" size="small" />
                          <ThemedText style={styles.buttonText}>Creating code...</ThemedText>
                        </View>
                      ) : (
                        <ThemedText style={styles.buttonText}>Create Reset Code</ThemedText>
                      )}
                    </TouchableOpacity>
                  </LinearGradient>
                ) : (
                  <>
                    {issuedResetCode && (
                      <View style={styles.resetInfoCard}>
                        <ThemedText style={styles.resetInfoLabel}>Reset code</ThemedText>
                        <ThemedText style={styles.resetCodeText}>{issuedResetCode}</ThemedText>
                        <ThemedText style={[styles.resetInfoText, resetCodeExpired && styles.resetInfoTextExpired]}>
                          {resetSecondsRemaining === null
                            ? 'Use this code before it expires.'
                            : resetCodeExpired
                              ? 'This code has expired. Create a new code.'
                              : `Expires in ${formatResetCountdown(resetSecondsRemaining)}`}
                        </ThemedText>
                      </View>
                    )}

                    <ThemedText style={styles.inputLabel}>Reset Code</ThemedText>
                    <TextInput
                      style={[styles.input, styles.resetCodeInput]}
                      placeholder="6-digit code"
                      value={resetCode}
                      onChangeText={(value) => setResetCode(value.replace(/\D/g, '').slice(0, 6))}
                      keyboardType="number-pad"
                      maxLength={6}
                      placeholderTextColor="#999"
                    />

                    <ThemedText style={styles.inputLabel}>New Password</ThemedText>
                    <View style={styles.inputWrapper}>
                      <TextInput
                        style={[styles.input, styles.passwordInput]}
                        placeholder="Enter new password"
                        value={newPassword}
                        onChangeText={setNewPassword}
                        secureTextEntry={!showNewPassword}
                        placeholderTextColor="#999"
                      />
                      <TouchableOpacity
                        style={styles.passwordToggle}
                        onPress={() => setShowNewPassword((show) => !show)}
                      >
                        <AppIcon name={showNewPassword ? 'eyeOff' : 'eye'} size={20} color="#666" />
                      </TouchableOpacity>
                    </View>

                    <ThemedText style={styles.inputLabel}>Confirm New Password</ThemedText>
                    <View style={styles.inputWrapper}>
                      <TextInput
                        style={[styles.input, styles.passwordInput]}
                        placeholder="Confirm new password"
                        value={confirmNewPassword}
                        onChangeText={setConfirmNewPassword}
                        secureTextEntry={!showConfirmNewPassword}
                        placeholderTextColor="#999"
                      />
                      <TouchableOpacity
                        style={styles.passwordToggle}
                        onPress={() => setShowConfirmNewPassword((show) => !show)}
                      >
                        <AppIcon name={showConfirmNewPassword ? 'eyeOff' : 'eye'} size={20} color="#666" />
                      </TouchableOpacity>
                    </View>

                    <LinearGradient
                      colors={['#FF8C42', '#FF7B2B']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.buttonGradient}
                    >
                      <TouchableOpacity
                        style={[styles.loginButton, (isResetLoading || resetCodeExpired) && styles.loginButtonDisabled]}
                        onPress={handleResetPassword}
                        disabled={isResetLoading || resetCodeExpired}
                      >
                        {isResetLoading ? (
                          <View style={styles.loadingContent}>
                            <ActivityIndicator color="#fff" size="small" />
                            <ThemedText style={styles.buttonText}>Resetting...</ThemedText>
                          </View>
                        ) : (
                          <ThemedText style={styles.buttonText}>Reset Password</ThemedText>
                        )}
                      </TouchableOpacity>
                    </LinearGradient>
                  </>
                )}

                <View style={styles.resetFooterRow}>
                  {authMode === 'reset' && (
                    <TouchableOpacity style={styles.secondaryActionButton} onPress={handleSendResetCode} disabled={isResetLoading}>
                      <ThemedText style={styles.secondaryActionText}>Create new code</ThemedText>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.secondaryActionButton} onPress={returnToLogin}>
                    <ThemedText style={styles.secondaryActionText}>Back to login</ThemedText>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const [isSplash, setIsSplash] = useState(true);
  const [showLogin, setShowLogin] = useState(false);

  const handleLogin = useCallback((userName: string, userRole: string) => {
    if (userRole === 'admin') {
      router.replace('/admin-dashboard');
    } else if (userRole === 'mechanic') {
      router.replace({
        pathname: '/mechanic-dashboard',
        params: { mechanicName: userName }
      } as any);
    } else if (userRole === 'tower') {
      router.replace({
        pathname: '/tower-dashboard',
        params: { towerName: userName }
      } as any);
    } else {
      // Default to driver dashboard
      router.replace({
        pathname: '/driver-dashboard',
        params: { driverName: userName }
      } as any);
    }
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsSplash(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    (async () => {
      const [savedUserId, savedRole, savedDriverName, savedMechanicName, savedTowerName] = await Promise.all([
        AsyncStorage.getItem(USER_ID_KEY),
        AsyncStorage.getItem(USER_ROLE_KEY),
        AsyncStorage.getItem(DRIVER_NAME_KEY),
        AsyncStorage.getItem(MECHANIC_NAME_KEY),
        AsyncStorage.getItem(TOWER_NAME_KEY),
      ]);

      if (savedUserId && savedRole) {
        handleLogin(
          savedRole === 'admin'
            ? savedDriverName || 'Admin'
            : savedRole === 'mechanic'
            ? savedMechanicName || savedDriverName || 'Mechanic'
            : savedRole === 'tower'
              ? savedTowerName || savedDriverName || 'Tow Provider'
              : savedDriverName || 'Driver',
          savedRole
        );
        return;
      }

      setShowLogin(true);
    })();
  }, [handleLogin]);

  if (isSplash) {
    return (
      <LinearGradient
        colors={['#FFB84D', '#FF8C42']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.splashContainer}
      >
        <Image
          source={logoImage}
          style={styles.splashLogo}
        />
        <ThemedText type="title" style={styles.splashText}>RoadResQ</ThemedText>
      </LinearGradient>
    );
  }

  if (showLogin) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return null;
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogo: {
    height: 100,
    width: 150,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  splashText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
  },
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
    paddingVertical: 20,
    paddingTop: 20,
  },
  formCard: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 20,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  logo: {
    height: 80,
    width: 120,
    marginBottom: 20,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 24,
    fontWeight: '500',
  },
  input: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    marginBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: '#f5f5f5',
    fontSize: 15,
    color: '#333',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  testCredentialsContainer: {
    backgroundColor: '#FFF3E0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#FF8C42',
  },
  testCredentialsLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E65100',
    marginBottom: 8,
  },
  testCredentialsText: {
    fontSize: 11,
    color: '#D84315',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  buttonGradient: {
    borderRadius: 12,
    marginTop: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },
  loginButton: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  loginButtonDisabled: {
    opacity: 0.8,
  },
  loadingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
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
  resetActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    marginBottom: 0,
  },
  resetActionSpacer: {
    flex: 1,
  },
  resetActionButton: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  resetActionText: {
    fontSize: 13,
    color: '#A65A2D',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  resetHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFF3E8',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FFE0CC',
  },
  resetStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  resetStepBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F1F1',
    borderWidth: 1,
    borderColor: '#E2E2E2',
  },
  resetStepBadgeActive: {
    backgroundColor: '#FF8C42',
    borderColor: '#FF8C42',
  },
  resetStepBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },
  resetStepBadgeTextMuted: {
    color: '#777',
  },
  resetStepLine: {
    width: 54,
    height: 2,
    backgroundColor: '#E2E2E2',
  },
  resetStepLineActive: {
    backgroundColor: '#FF8C42',
  },
  resetInfoCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  resetInfoLabel: {
    fontSize: 12,
    color: '#9A4A12',
    fontWeight: '700',
    marginBottom: 6,
  },
  resetCodeText: {
    fontSize: 28,
    color: '#333',
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
    marginBottom: 6,
  },
  resetInfoText: {
    fontSize: 12,
    color: '#8A5A28',
    textAlign: 'center',
    lineHeight: 17,
  },
  resetInfoTextExpired: {
    color: '#d32f2f',
    fontWeight: '700',
  },
  resetCodeInput: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
  },
  resetFooterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 4,
  },
  secondaryActionButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  secondaryActionText: {
    fontSize: 13,
    color: '#A65A2D',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  inputWrapper: {
    width: '100%',
    position: 'relative',
    marginBottom: 12,
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
  eyeIcon: {
    fontSize: 20,
  },
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';

const DRIVER_NAME_KEY = 'driverName';
const MECHANIC_NAME_KEY = 'mechanicName';
const TOWER_NAME_KEY = 'towerName';
const CURRENT_USER_ROLE_KEY = 'currentUserRole';

type UserRole = 'driver' | 'mechanic' | 'tower';

export default function RoleSelectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [userName, setUserName] = useState('User');

  useEffect(() => {
    (async () => {
      const routeUserName = typeof params.userName === 'string' ? params.userName : '';
      if (routeUserName.trim()) {
        setUserName(routeUserName.trim());
        return;
      }

      const savedName = await AsyncStorage.getItem(DRIVER_NAME_KEY);
      setUserName(savedName || 'User');
    })();
  }, [params.userName]);

  const handleRoleSelect = async (role: UserRole) => {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    try {
      await AsyncStorage.setItem(CURRENT_USER_ROLE_KEY, role);

      if (role === 'driver') {
        router.replace({
          pathname: '/driver-dashboard',
          params: { driverName: userName },
        } as any);
      } else if (role === 'mechanic') {
        // Save mechanic name for mechanic dashboard
        await AsyncStorage.setItem(MECHANIC_NAME_KEY, userName);
        router.replace('/mechanic-dashboard');
      } else {
        await AsyncStorage.setItem(TOWER_NAME_KEY, userName);
        router.replace('/tower-dashboard');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#FFEBD0', '#FFD9B5']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientContainer}
      >
        <View style={styles.card}>
          <ThemedText style={styles.title}>Login As</ThemedText>
          <ThemedText style={styles.subtitle}>
            Hello {userName}, choose how you want to use the app.
          </ThemedText>

          <TouchableOpacity
            style={[styles.roleButton, isLoading ? styles.disabledButton : null]}
            onPress={() => handleRoleSelect('driver')}
            disabled={isLoading}
          >
            <ThemedText style={styles.roleButtonText}>Driver</ThemedText>
            <ThemedText style={styles.roleHint}>Make requests for mechanic or towing help</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.roleButton, styles.mechanicButton, isLoading ? styles.disabledButton : null]}
            onPress={() => handleRoleSelect('mechanic')}
            disabled={isLoading}
          >
            <ThemedText style={styles.roleButtonText}>Mechanic</ThemedText>
            <ThemedText style={styles.roleHint}>Receive service requests and accept or decline</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.roleButton, styles.towerButton, isLoading ? styles.disabledButton : null]}
            onPress={() => handleRoleSelect('tower')}
            disabled={isLoading}
          >
            <ThemedText style={styles.roleButtonText}>Tow Provider</ThemedText>
            <ThemedText style={styles.roleHint}>Register your towing company</ThemedText>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradientContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#333',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  roleButton: {
    borderRadius: 12,
    backgroundColor: '#FF8C42',
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  mechanicButton: {
    backgroundColor: '#2C7A7B',
  },
  towerButton: {
    backgroundColor: '#374151',
  },
  roleButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  roleHint: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    opacity: 0.95,
  },
  disabledButton: {
    opacity: 0.75,
  },
});

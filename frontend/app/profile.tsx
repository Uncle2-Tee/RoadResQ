import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, View } from 'react-native';
import { AppIcon } from '../components/app-icon';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { getUserProfile, updateUserProfile } from '../services/api-client';
import { photoService } from '../services/photo-service';

const PROFILE_PHOTO_URI_KEY = 'driverProfilePhotoUri';
const DRIVER_NAME_KEY = 'driverName';
const DRIVER_PHONE_KEY = 'driverPhone';
const CURRENT_USER_EMAIL_KEY = 'currentUserEmail';
const USER_ID_KEY = 'userId';

export default function ProfileScreen() {
  const router = useRouter();
  const [name, setName] = useState('John Doe');
  const [email, setEmail] = useState('Not provided');
  const [phone, setPhone] = useState('Not provided');
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadProfileData();
  }, []);

  const loadProfileData = async () => {
    try {
      const [savedPhotoUri, savedName, savedPhone, savedEmail] = await Promise.all([
        photoService.getProfilePhoto(),
        AsyncStorage.getItem(DRIVER_NAME_KEY),
        AsyncStorage.getItem(DRIVER_PHONE_KEY),
        AsyncStorage.getItem(CURRENT_USER_EMAIL_KEY),
      ]);

      setProfilePhotoUri(savedPhotoUri || null);
      setName(savedName || 'John Doe');
      setPhone(savedPhone || 'Not provided');
      setEmail(savedEmail || 'Not provided');

      const savedUserId = await AsyncStorage.getItem(USER_ID_KEY);
      if (!savedUserId) {
        return;
      }

      const user = await getUserProfile(savedUserId).catch((error) => {
        const message = error instanceof Error ? error.message : 'Unable to refresh profile from server';
        console.warn('Profile is using saved local data:', message);
        return null;
      });

      if (!user) {
        return;
      }

      setName(user.name || 'John Doe');
      setPhone(user.phone || 'Not provided');
      setEmail(user.email || 'Not provided');
      setProfilePhotoUri(user.profilePhotoUri || null);

      await AsyncStorage.multiSet([
        [DRIVER_NAME_KEY, user.name],
        [DRIVER_PHONE_KEY, user.phone || ''],
        [CURRENT_USER_EMAIL_KEY, user.email],
      ]);

      if (user.profilePhotoUri) {
        await photoService.saveProfilePhoto(user.profilePhotoUri);
      } else {
        await AsyncStorage.removeItem(PROFILE_PHOTO_URI_KEY);
      }
    } catch (error) {
      console.error('Error loading profile data:', error);
    }
  };

  const handlePickPhoto = async () => {
    setLoading(true);
    try {
      const photoUri = await photoService.pickProfilePhoto();
      if (photoUri) {
        setProfilePhotoUri(photoUri);
        const savedUserId = await AsyncStorage.getItem(USER_ID_KEY);
        if (savedUserId) {
          await updateUserProfile(savedUserId, { profilePhotoUri: photoUri });
        }
        Alert.alert('Success', 'Profile photo updated successfully!');
      }
    } catch (error) {
      console.error('Error picking photo:', error);
      Alert.alert('Error', 'Failed to pick photo. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ThemedText style={styles.backButtonText}>←</ThemedText>
        </TouchableOpacity>
        <ThemedText type="title" style={styles.title}>Profile</ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarWrapper}>
          <View style={[styles.avatarButton, loading && styles.avatarButtonDisabled]}>
            <View style={styles.avatarCircle}>
              {profilePhotoUri ? (
                <Image source={{ uri: profilePhotoUri }} style={styles.avatarImage} />
              ) : (
                <ThemedText style={styles.avatarInitial}>{name.charAt(0).toUpperCase() || 'U'}</ThemedText>
              )}
              {loading && (
                <View style={styles.avatarLoadingOverlay}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={handlePickPhoto}
              disabled={loading}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
              style={styles.avatarEditBadge}
            >
              <AppIcon name="camera" size={18} color="#fff" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.formCard}>
          <ThemedText style={styles.label}>Name</ThemedText>
          <ThemedText style={styles.valueText}>{name}</ThemedText>

          <ThemedText style={styles.label}>Email</ThemedText>
          <ThemedText style={styles.valueText}>{email}</ThemedText>

          <ThemedText style={styles.label}>Telephone Number</ThemedText>
          <ThemedText style={styles.valueText}>{phone}</ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 42,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  backButtonText: {
    fontSize: 24,
    color: '#000',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
  },
  content: {
    padding: 16,
    paddingBottom: 30,
  },
  avatarWrapper: {
    alignItems: 'center',
    marginBottom: 22,
  },
  avatarButton: {
    position: 'relative',
    width: 108,
    height: 108,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarButtonDisabled: {
    opacity: 0.85,
  },
  avatarCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#FF8C42',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 52,
  },
  avatarInitial: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '700',
  },
  avatarEditBadge: {
    position: 'absolute',
    right: 2,
    bottom: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FF8C42',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
  },
  label: {
    fontSize: 14,
    color: '#444',
    fontWeight: '600',
    marginBottom: 6,
  },
  valueText: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#333',
    marginBottom: 14,
    backgroundColor: '#fafafa',
  },
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

const PROFILE_PHOTO_URI_KEY = 'driverProfilePhotoUri';

export const photoService = {
  async pickProfilePhoto(): Promise<string | null> {
    try {
      // Request permission first
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        console.warn('Permission to access media library denied');
        return null;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const photoUri = result.assets[0].uri;
        
        // Save to AsyncStorage
        await AsyncStorage.setItem(PROFILE_PHOTO_URI_KEY, photoUri);
        
        return photoUri;
      }

      return null;
    } catch (error) {
      console.error('Error picking photo:', error);
      return null;
    }
  },

  async getProfilePhoto(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(PROFILE_PHOTO_URI_KEY);
    } catch (error) {
      console.error('Error getting profile photo:', error);
      return null;
    }
  },

  async deleteProfilePhoto(): Promise<void> {
    try {
      await AsyncStorage.removeItem(PROFILE_PHOTO_URI_KEY);
    } catch (error) {
      console.error('Error deleting profile photo:', error);
    }
  },

  async saveProfilePhoto(uri: string): Promise<void> {
    try {
      await AsyncStorage.setItem(PROFILE_PHOTO_URI_KEY, uri);
    } catch (error) {
      console.error('Error saving profile photo:', error);
    }
  },
};

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { AppIcon, type AppIconName } from './app-icon';
import { FastPressable } from './fast-pressable';
import { ThemedText } from './themed-text';
import { logoutImmediately } from '../services/session';

const PROFILE_PHOTO_URI_KEY = 'driverProfilePhotoUri';

interface MenuItem {
  label: string;
  route: string;
  icon: AppIconName;
  usesTowImage?: boolean;
  role?: 'driver' | 'mechanic' | 'tower' | 'admin' | 'both';
}

const towImage = require('../assets/images/tow.jpg');

const menuItems: MenuItem[] = [
  { label: 'Shop Approvals', route: '/admin-dashboard', icon: 'check', role: 'admin' },
  { label: 'Home', route: '/driver-dashboard', icon: 'home', role: 'driver' },
  { label: 'Register Shop', route: '/mechanic-register', icon: 'wrench', role: 'mechanic' },
  { label: 'Service Requests', route: '/mechanic-inbox', icon: 'inbox', role: 'mechanic' },
  { label: 'Home', route: '/tower-dashboard', icon: 'home', role: 'tower' },
  { label: 'Register Towing Company', route: '/tower-register', icon: 'store', usesTowImage: true, role: 'tower' },
  { label: 'Requests History', route: '/request', icon: 'list', role: 'tower' },
  { label: 'Transactions', route: '/transaction-history', icon: 'creditCard', role: 'tower' },
  { label: 'Request Tow', route: '/tow-request', icon: 'car', usesTowImage: true, role: 'driver' },
  { label: 'Requests History', route: '/request', icon: 'list', role: 'driver' },
  { label: 'Payment', route: '/payment', icon: 'creditCard', role: 'driver' },
];

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  driverName?: string;
  role?: 'driver' | 'mechanic' | 'tower' | 'admin';
}

function DrawerComponent({
  isOpen,
  onClose,
  driverName = 'User',
  role = 'driver',
}: DrawerProps) {
  const router = useRouter();
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setPhotoViewerOpen(false);
      return;
    }

    (async () => {
      const savedUri = await AsyncStorage.getItem(PROFILE_PHOTO_URI_KEY);
      setProfilePhotoUri(savedUri || null);
    })();
  }, [isOpen]);

  const filteredMenuItems = useMemo(
    () => menuItems.filter((item) => item.role === 'both' || item.role === role),
    [role]
  );

  const handleMenuItemPress = useCallback((route: string) => {
    onClose();
    router.push(route);
  }, [onClose, router]);

  const handleLogout = useCallback(async () => {
    onClose();
    await logoutImmediately(() => router.replace('/login'));
  }, [onClose, router]);

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.drawerOverlay}>
        <View style={styles.drawerContainer}>
          <FastPressable
            style={styles.closeButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          >
            <AppIcon name="close" size={22} color="#333" />
          </FastPressable>

          <View style={styles.profileSection}>
            <FastPressable
              style={styles.profileCircle}
              onPress={() => profilePhotoUri && setPhotoViewerOpen(true)}
              disabled={!profilePhotoUri}
              accessibilityRole={profilePhotoUri ? 'imagebutton' : 'image'}
              accessibilityLabel={profilePhotoUri ? 'View profile picture' : 'Profile picture'}
            >
              {profilePhotoUri ? (
                <Image source={{ uri: profilePhotoUri }} style={styles.profileImage} />
              ) : (
                <ThemedText style={styles.profileInitial}>{driverName.charAt(0).toUpperCase()}</ThemedText>
              )}
            </FastPressable>
            <ThemedText style={styles.profileName}>{driverName}</ThemedText>
          </View>

          <ThemedText style={styles.drawerTitle}>Menu</ThemedText>
          <ScrollView showsVerticalScrollIndicator={false}>
            {filteredMenuItems.map((item) => (
              <FastPressable
                key={`${item.role}-${item.route}`}
                style={styles.menuItem}
                onPress={() => handleMenuItemPress(item.route)}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                {item.usesTowImage ? (
                  <Image source={towImage} style={styles.menuItemTowImage} resizeMode="cover" />
                ) : (
                  <AppIcon name={item.icon} size={21} color="#FF8C42" style={styles.menuItemIcon} />
                )}
                <ThemedText style={styles.menuItemText}>{item.label}</ThemedText>
              </FastPressable>
            ))}
            <View style={styles.logoutMenuContainer}>
              <FastPressable
                style={styles.logoutMenuButton}
                onPress={handleLogout}
                accessibilityRole="button"
                accessibilityLabel="Log out"
              >
                <AppIcon name="logout" size={21} color="#d32f2f" style={styles.logoutMenuIcon} />
              </FastPressable>
              <ThemedText style={styles.logoutMenuText}>Logout</ThemedText>
            </View>
          </ScrollView>
        </View>
        <FastPressable
          style={styles.drawerBackdrop}
          onPress={onClose}
          haptic={false}
          pressedStyle={styles.drawerBackdropPressed}
          accessibilityRole="button"
          accessibilityLabel="Close menu backdrop"
        />
        {photoViewerOpen && profilePhotoUri && (
          <View style={styles.photoViewer}>
            <FastPressable
              style={styles.photoViewerBackdrop}
              onPress={() => setPhotoViewerOpen(false)}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Close profile picture"
            />
            <View style={styles.photoViewerContent} pointerEvents="box-none">
              <Image
                source={{ uri: profilePhotoUri }}
                style={styles.fullProfileImage}
                resizeMode="contain"
                accessibilityLabel={`${driverName}'s profile picture`}
              />
              <FastPressable
                style={styles.photoViewerCloseButton}
                onPress={() => setPhotoViewerOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close profile picture"
              >
                <AppIcon name="close" size={26} color="#fff" />
              </FastPressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

export const Drawer = memo(DrawerComponent);

const styles = StyleSheet.create({
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    justifyContent: 'flex-start',
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  drawerBackdropPressed: {
    opacity: 1,
    transform: [{ scale: 1 }],
  },
  drawerContainer: {
    width: '70%',
    maxWidth: 280,
    backgroundColor: '#fff',
    paddingTop: 50,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 2,
  },
  closeButton: {
    position: 'absolute',
    top: 45,
    right: 15,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 30,
    paddingTop: 20,
  },
  profileCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FF8C42',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  profileImage: {
    width: '100%',
    height: '100%',
  },
  profileInitial: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
  },
  drawerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuItemIcon: {
    marginRight: 15,
  },
  menuItemTowImage: {
    width: 28,
    height: 22,
    borderRadius: 6,
    marginRight: 12,
  },
  menuItemText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  logoutMenuContainer: {
    alignItems: 'center',
    marginTop: 30,
  },
  logoutMenuButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#ffebee',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  logoutMenuIcon: {
    marginLeft: 1,
  },
  logoutMenuText: {
    fontSize: 12,
    color: '#d32f2f',
    fontWeight: '600',
  },
  photoViewer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    elevation: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoViewerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  photoViewerContent: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  fullProfileImage: {
    width: '100%',
    height: '82%',
  },
  photoViewerCloseButton: {
    position: 'absolute',
    top: 46,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

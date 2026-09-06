import { useRouter } from 'expo-router';
import { memo, useCallback } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { AppIcon } from './app-icon';
import { FastPressable } from './fast-pressable';
import { ThemedText } from './themed-text';

interface BottomNavProps {
  onHomePress?: () => void;
  onProfilePress?: () => void;
  showHome?: boolean;
  showProfile?: boolean;
}

const IS_IOS = Platform.OS === 'ios';
const NAV_ICON_SIZE = IS_IOS ? 26 : 24;

function BottomNavComponent({
  onHomePress,
  onProfilePress,
  showHome = true,
  showProfile = false,
}: BottomNavProps) {
  const router = useRouter();

  const handleHome = useCallback(() => {
    if (onHomePress) {
      onHomePress();
    } else {
      router.push('/driver-dashboard');
    }
  }, [onHomePress, router]);

  const handleProfile = useCallback(() => {
    if (onProfilePress) {
      onProfilePress();
    }
  }, [onProfilePress]);

  if (!showHome && !showProfile) {
    return null;
  }

  return (
    <View style={styles.bottomNav}>
      {showHome && (
        <FastPressable
          style={styles.navItem}
          onPress={handleHome}
          accessibilityRole="button"
          accessibilityLabel="Go home"
        >
          <AppIcon name="home" size={NAV_ICON_SIZE} color="#FF8C42" style={styles.navIcon} />
          <ThemedText style={styles.navLabel}>Home</ThemedText>
        </FastPressable>
      )}
      {showProfile && (
        <FastPressable
          style={styles.navItem}
          onPress={handleProfile}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
        >
          <AppIcon name="user" size={NAV_ICON_SIZE} color="#FF8C42" style={styles.navIcon} />
          <ThemedText style={styles.navLabel}>Profile</ThemedText>
        </FastPressable>
      )}
    </View>
  );
}

export const BottomNav = memo(BottomNavComponent);

const styles = StyleSheet.create({
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: IS_IOS ? 10 : 6,
    paddingBottom: IS_IOS ? 18 : 6,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: IS_IOS ? 72 : 56,
    minHeight: IS_IOS ? 54 : 44,
    paddingVertical: IS_IOS ? 6 : 4,
  },
  navIcon: {
    marginBottom: IS_IOS ? 3 : 2,
  },
  navLabel: {
    fontSize: IS_IOS ? 13 : 12,
    color: '#FF8C42',
    fontWeight: '500',
  },
});

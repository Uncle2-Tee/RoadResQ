import { useEffect, useState } from 'react';
import { Dimensions, ScaledSize, Platform } from 'react-native';

interface ResponsiveValues {
  window: ScaledSize;
  isSmallScreen: boolean;
  isMediumScreen: boolean;
  isLargeScreen: boolean;
  scale: number;
  isTablet: boolean;
  isMobile: boolean;
  isPortrait: boolean;
  isLandscape: boolean;
  containerWidth: number;
  containerHeight: number;
  isIOS: boolean;
  isAndroid: boolean;
}

export function useResponsive(): ResponsiveValues {
  const [dimensions, setDimensions] = useState(() => ({
    window: Dimensions.get('window'),
  }));

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions({ window });
    });

    return () => subscription?.remove();
  }, []);

  const { window } = dimensions;
  
  // Device classification
  const isSmallScreen = window.width < 375;
  const isMediumScreen = window.width >= 375 && window.width < 768;
  const isLargeScreen = window.width >= 768;
  const isTablet = window.width >= 600;
  const isMobile = !isTablet;
  
  // Orientation detection
  const isPortrait = window.height > window.width;
  const isLandscape = window.width > window.height;
  
  // Platform detection
  const isIOS = Platform.OS === 'ios';
  const isAndroid = Platform.OS === 'android';
  
  // Smart container sizing
  const containerWidth = isTablet ? Math.min(window.width, 800) : window.width;
  const containerHeight = window.height;
  
  // Base scale for responsive sizing. iOS renders several fixed-size cards/buttons
  // a little tighter, so give phone layouts a small platform lift.
  const baseScale = window.width / 375;
  const platformScale = isIOS && isMobile ? Math.max(baseScale * 1.06, 1) : baseScale;
  const scale = isIOS && isMobile ? Math.min(platformScale, 1.16) : platformScale;

  return {
    window,
    isSmallScreen,
    isMediumScreen,
    isLargeScreen,
    scale,
    isTablet,
    isMobile,
    isPortrait,
    isLandscape,
    containerWidth,
    containerHeight,
    isIOS,
    isAndroid,
  };
}

export function useResponsiveValue<T>(small: T, medium: T, large: T, tablet?: T): T {
  const { isSmallScreen, isMediumScreen, isTablet: isTabletSize } = useResponsive();
  
  if (isTabletSize && tablet) return tablet;
  if (isSmallScreen) return small;
  if (isMediumScreen) return medium;
  return large;
}

// Hook for responsive spacing/padding
export function useResponsiveSpacing() {
  const { scale, isSmallScreen, isIOS } = useResponsive();
  const iosBoost = isIOS ? 2 : 0;

  return {
    xs: (isSmallScreen ? 4 : 6) + iosBoost,
    sm: (isSmallScreen ? 8 : 10) + iosBoost,
    md: (isSmallScreen ? 12 : 14) + iosBoost,
    lg: (isSmallScreen ? 16 : 18) + iosBoost,
    xl: (isSmallScreen ? 20 : 24) + iosBoost,
    scale,
  };
}

// Hook for responsive text sizes
export function useResponsiveText() {
  const { scale } = useResponsive();

  return {
    xs: 12 * scale,
    sm: 13 * scale,
    base: 14 * scale,
    lg: 16 * scale,
    xl: 18 * scale,
    xxxl: 24 * scale,
    scale,
  };
}

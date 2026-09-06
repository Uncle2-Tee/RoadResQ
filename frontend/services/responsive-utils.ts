/**
 * Responsive Design Utilities
 * 
 * This file provides responsive utilities for building mobile-first,
 * adaptive UIs that work across all device sizes.
 */

import { Dimensions } from 'react-native';
import { useResponsive, useResponsiveValue, useResponsiveSpacing, useResponsiveText } from '../hooks/use-responsive';

/**
 * Device size breakpoints
 */
export const breakpoints = {
  xs: 320,      // Small phones
  sm: 375,      // Standard phones (iPhone SE)
  md: 414,      // Standard phones (iPhone 12)
  lg: 480,      // Large phones, small tablets
  xl: 600,      // Tablets
  xxl: 768,     // Larger tablets
  xxxl: 1024,   // iPads
};

/**
 * Responsive container helper
 */
export function getMaxContainerWidth(screenWidth: number): number {
  if (screenWidth >= breakpoints.xxxl) return 1200;
  if (screenWidth >= breakpoints.xxl) return 960;
  if (screenWidth >= breakpoints.xl) return 768;
  if (screenWidth >= breakpoints.lg) return 600;
  if (screenWidth >= breakpoints.md) return 414;
  return screenWidth;
}

/**
 * Responsive padding helper
 */
export function getResponsivePadding(screenWidth: number): number {
  if (screenWidth >= breakpoints.xl) return 32;
  if (screenWidth >= breakpoints.lg) return 20;
  if (screenWidth >= breakpoints.sm) return 16;
  return 12;
}

/**
 * Easy responsive values based on screen width
 */
export function createResponsiveValue<T>(config: {
  xs?: T;
  sm?: T;
  md?: T;
  lg?: T;
  xl?: T;
  xxl?: T;
  xxxl?: T;
}): T {
  const width = Dimensions.get('window').width;

  if (width >= breakpoints.xxxl && config.xxxl) return config.xxxl;
  if (width >= breakpoints.xxl && config.xxl) return config.xxl;
  if (width >= breakpoints.xl && config.xl) return config.xl;
  if (width >= breakpoints.lg && config.lg) return config.lg;
  if (width >= breakpoints.md && config.md) return config.md;
  if (width >= breakpoints.sm && config.sm) return config.sm;
  if (width >= breakpoints.xs && config.xs) return config.xs;
  
  // Fallback to any available value
  return Object.values(config).find(v => v !== undefined) as T;
}

/**
 * Export all responsive utilities
 */
export {
  useResponsive,
  useResponsiveValue,
  useResponsiveSpacing,
  useResponsiveText,
};

/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useColorScheme as useColorSchemeRN } from 'react-native';

export function useColorScheme(): 'light' | 'dark' | null | undefined {
  return useColorSchemeRN();
}

import type React from 'react';
import { StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';

import { useThemeColor } from '../hooks/use-theme-color';

export interface ThemedViewProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
  lightColor?: string;
  darkColor?: string;
  children?: React.ReactNode;
}

export function ThemedView({ style, lightColor, darkColor, children, ...otherProps }: ThemedViewProps) {
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return <View style={[{ backgroundColor }, styles.background, style]} {...otherProps}>{children}</View>;
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
});

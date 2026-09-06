import type React from 'react';
import { StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';

export interface ParallaxScrollViewProps extends ViewProps {
  headerBackgroundColor?: { dark: string; light: string };
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function ParallaxScrollView({ headerBackgroundColor, children, style }: ParallaxScrollViewProps) {
  return (
    <View style={[styles.container, style]}>
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

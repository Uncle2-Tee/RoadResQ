import type React from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import Animated, {
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withTiming
} from 'react-native-reanimated';

import { Colors } from '../../constants/theme';
import { ThemedText } from '../themed-text';
import { ThemedView } from '../themed-view';
import { Pressable } from '../haptic-pressable';

export interface CollapsibleProps {
  title: string;
  children?: React.ReactNode;
}

export function Collapsible({ title, children }: CollapsibleProps) {
  const animation = useSharedValue(0);
  const collapseAnimation = useSharedValue(0);
  const theme = useColorScheme() ?? 'light';
  const tintColor = theme === 'dark' ? Colors.dark.tint : Colors.light.tint;

  const toggleCollapsible = () => {
    animation.value = withTiming(animation.value ? 0 : 1, { duration: 300 });
    collapseAnimation.value = withTiming(collapseAnimation.value ? 0 : 1, { duration: 300 });
  };

  const animatedArrowStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${interpolate(animation.value, [0, 1], [0, 180])}deg` }],
    };
  });

  const animatedChildrenStyle = useAnimatedStyle(() => {
    return {
      opacity: collapseAnimation.value,
      maxHeight: interpolate(collapseAnimation.value, [0, 1], [0, 1000]),
    };
  });

  return (
    <ThemedView>
      <Pressable
        style={styles.heading}
        onPress={toggleCollapsible}>
        <Animated.View style={animatedArrowStyle}>
          <ThemedText style={{ fontSize: 18 }}>▶</ThemedText>
        </Animated.View>
        <ThemedText style={styles.headingText}>{title}</ThemedText>
      </Pressable>
      {children && <Animated.View style={animatedChildrenStyle}>{children}</Animated.View>}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: 6,
    flexDirection: 'row',
    paddingVertical: 12,
  },
  headingText: {
    fontWeight: 'bold',
    fontSize: 16,
  },
});

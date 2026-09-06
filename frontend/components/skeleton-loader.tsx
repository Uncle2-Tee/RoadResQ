import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

interface SkeletonLoaderProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  marginBottom?: number;
  variant?: 'text' | 'circle' | 'rect';
}

export function SkeletonLoader({
  width = '100%',
  height = 20,
  borderRadius = 4,
  marginBottom = 8,
  variant = 'rect',
}: SkeletonLoaderProps) {
  const shimmerAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnimation, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnimation, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [shimmerAnimation]);

  const opacity = shimmerAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  const dynamicBorderRadius =
    variant === 'circle' ? (typeof width === 'number' ? width / 2 : 50) : borderRadius;

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width: typeof width === 'number' ? width : width,
          height,
          borderRadius: dynamicBorderRadius,
          marginBottom,
          opacity,
        } as any,
      ]}
    />
  );
}

interface SkeletonLineProps {
  count?: number;
  spacing?: number;
}

export function SkeletonLines({ count = 3, spacing = 10 }: SkeletonLineProps) {
  return (
    <View>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonLoader
          key={index}
          width={index === count - 1 ? '70%' : '100%'}
          height={16}
          marginBottom={spacing}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: '#e0e0e0',
  },
});

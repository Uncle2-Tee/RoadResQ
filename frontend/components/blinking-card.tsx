import type { PropsWithChildren } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';

type BlinkingCardProps = PropsWithChildren<{
  active: boolean;
  style?: StyleProp<ViewStyle>;
}>;

export function BlinkingCard({ active, children, style }: BlinkingCardProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      opacity.setValue(1);
      scale.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0.18,
            duration: 520,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.985,
            duration: 520,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 520,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 520,
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [active, opacity, scale]);

  return <Animated.View style={[style, { opacity, transform: [{ scale }] }]}>{children}</Animated.View>;
}

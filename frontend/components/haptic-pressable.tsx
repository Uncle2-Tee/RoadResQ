import * as Haptics from 'expo-haptics';
import { memo, useCallback } from 'react';
import {
  GestureResponderEvent,
  Platform,
  Pressable as RNPressable,
  PressableProps,
} from 'react-native';

type HapticPressableProps = PressableProps & {
  haptic?: boolean;
};

function HapticPressableComponent({
  disabled,
  haptic = true,
  hitSlop,
  onPressIn,
  ...props
}: HapticPressableProps) {
  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (haptic && !disabled && Platform.OS !== 'web') {
        Haptics.selectionAsync().catch(() => {});
      }
      onPressIn?.(event);
    },
    [disabled, haptic, onPressIn]
  );

  return (
    <RNPressable
      {...props}
      disabled={disabled}
      hitSlop={hitSlop ?? (Platform.OS === 'ios' ? 8 : undefined)}
      onPressIn={handlePressIn}
    />
  );
}

export const Pressable = memo(HapticPressableComponent);

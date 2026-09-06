import * as Haptics from 'expo-haptics';
import { memo, useCallback } from 'react';
import {
  GestureResponderEvent,
  Platform,
  TouchableOpacity as RNTouchableOpacity,
  TouchableOpacityProps,
} from 'react-native';

type HapticTouchableOpacityProps = TouchableOpacityProps & {
  haptic?: boolean;
};

function HapticTouchableOpacityComponent({
  disabled,
  haptic = true,
  hitSlop,
  onPressIn,
  ...props
}: HapticTouchableOpacityProps) {
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
    <RNTouchableOpacity
      {...props}
      delayPressIn={props.delayPressIn ?? 0}
      disabled={disabled}
      hitSlop={hitSlop ?? (Platform.OS === 'ios' ? 8 : undefined)}
      onPressIn={handlePressIn}
    />
  );
}

export const TouchableOpacity = memo(HapticTouchableOpacityComponent);

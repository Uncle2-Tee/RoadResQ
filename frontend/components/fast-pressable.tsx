import * as Haptics from 'expo-haptics';
import { memo, useCallback } from 'react';
import {
  GestureResponderEvent,
  Platform,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';

type FastPressableProps = PressableProps & {
  pressedStyle?: StyleProp<ViewStyle>;
  haptic?: boolean;
};

function FastPressableComponent({
  children,
  disabled,
  hitSlop = Platform.OS === 'ios' ? 10 : 8,
  haptic = true,
  onPressIn,
  pressedStyle,
  style,
  ...props
}: FastPressableProps) {
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
    <Pressable
      {...props}
      android_ripple={
        props.android_ripple || { color: 'rgba(0, 0, 0, 0.08)', borderless: false }
      }
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={handlePressIn}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        state.pressed && !disabled
          ? [{ opacity: 0.82, transform: [{ scale: 0.985 }] }, pressedStyle]
          : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

export const FastPressable = memo(FastPressableComponent);

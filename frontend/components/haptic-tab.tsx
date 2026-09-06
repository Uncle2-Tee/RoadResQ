import { PlatformPressable } from '@react-navigation/elements';
import * as Haptics from 'expo-haptics';
import type React from 'react';
import { GestureResponderEvent, Platform } from 'react-native';

type PlatformPressableProps = React.ComponentProps<typeof PlatformPressable>;

export function HapticTab(props: PlatformPressableProps) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev: GestureResponderEvent) => {
        if (!props.disabled && Platform.OS !== 'web') {
          Haptics.selectionAsync().catch(() => {});
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}

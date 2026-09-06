import { SymbolView, SymbolWeight } from 'expo-symbols';
import { OpaqueColorValue, StyleProp, ViewStyle } from 'react-native';

export interface IconSymbolProps {
  name: string;
  size?: number;
  color?: string | OpaqueColorValue;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
}

/**
 * A symbol icon component. This `should` only be used on iOS 13.1+. If you use these on older iOS versions,
 * they will not render.
 *
 * On Android and web, this will fall back to a placeholder image or your app icon.
 */
export function IconSymbol({ name, size = 24, color, style, weight = 'regular' }: IconSymbolProps) {
  return (
    <SymbolView
      weight={weight}
      tintColor={color}
      resizeMode="scaleAspectFit"
      name={name as any}
      style={[
        {
          width: size,
          height: size,
        },
        style,
      ]}
    />
  );
}

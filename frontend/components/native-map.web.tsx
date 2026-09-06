import { ReactNode } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

type WebMapViewProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

type WebMarkerProps = {
  children?: ReactNode;
};

export type NativeMapView = View;

export function Marker({ children }: WebMarkerProps) {
  return <>{children}</>;
}

export default function WebMapView({ children, style }: WebMapViewProps) {
  return <View style={style}>{children}</View>;
}

import { StyleSheet, View } from 'react-native';

type LocationPinProps = {
  color?: string;
  size?: number;
};

export function LocationPin({ color = '#FF4500', size = 44 }: LocationPinProps) {
  const headSize = size * 0.72;
  const centerSize = headSize * 0.46;

  return (
    <View style={[styles.container, { width: size, height: size }]} collapsable={false}>
      <View
        style={[
          styles.pin,
          {
            width: headSize,
            height: headSize,
            borderRadius: headSize / 2,
            backgroundColor: color,
          },
        ]}
      >
        <View
          style={[
            styles.center,
            {
              width: centerSize,
              height: centerSize,
              borderRadius: centerSize / 2,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pin: {
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomLeftRadius: 2,
    transform: [{ rotate: '-45deg' }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 6,
  },
  center: {
    backgroundColor: '#fff',
  },
});

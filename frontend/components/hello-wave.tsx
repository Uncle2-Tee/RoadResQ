import Animated from 'react-native-reanimated';

export function HelloWave() {
  const rotationAnimation = {
    '50%': { transform: [{ rotate: '25deg' }] },
  };

  // @ts-ignore - Animated.Text doesn't have full type support for web-like animations
  return (
    <Animated.Text
      style={{
        fontSize: 28,
        lineHeight: 32,
        marginTop: -6,
        animationName: rotationAnimation,
        animationDuration: '0.5s',
        animationIterationCount: 'infinite',
      }}>
      👋
    </Animated.Text>
  );
}

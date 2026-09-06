export const Colors = {
  light: {
    text: '#000',
    background: '#fff',
    tint: '#0a7ea4',
    tabIconDefault: '#687076',
    tabIconSelected: '#0a7ea4',
    icon: '#687076',
  },
  dark: {
    text: '#fff',
    background: '#000',
    tint: '#fff',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: '#fff',
    icon: '#9BA1A6',
  },
} as const;

export type ThemeColors = typeof Colors;

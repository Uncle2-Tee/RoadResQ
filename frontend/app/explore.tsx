import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon } from '../components/app-icon';
import { BottomNav } from '../components/bottom-nav';
import { Drawer } from '../components/drawer';
import { TouchableOpacity } from '../components/haptic-touchable-opacity';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';

export default function ExploreScreen() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerContainer}>
        <TouchableOpacity
          style={styles.menuIcon}
          onPress={() => setDrawerOpen(true)}
        >
          <AppIcon name="menu" size={28} color="#000" />
        </TouchableOpacity>
        <ThemedText type="title" style={styles.titleText}>Explore</ThemedText>
      </View>
      <View style={styles.titleContainer}>
        <ThemedText style={styles.stepContainer}>
        This is the explore screen. You can add content here.
      </ThemedText>
      </View>
      <BottomNav />
      <Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} role="driver" />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 40,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  menuIcon: {
    padding: 10,
    marginRight: 15,
  },
  titleText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
    padding: 20,
    paddingTop: 40,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
    fontSize: 16,
  },
});

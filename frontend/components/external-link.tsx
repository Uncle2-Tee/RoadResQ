import { Link } from 'expo-router';
import type React from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from './themed-text';

export interface ExternalLinkProps {
  href: string;
  children: React.ReactNode;
}

export function ExternalLink(props: ExternalLinkProps) {
  return (
    <Link href={props.href} asChild>
      <ThemedText style={styles.link}>{props.children}</ThemedText>
    </Link>
  );
}

const styles = StyleSheet.create({
  link: {
    lineHeight: 30,
  },
});

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppIcon } from './app-icon';
import { TouchableOpacity } from './haptic-touchable-opacity';
import { ThemedText } from './themed-text';

type SmsMessageModalProps = {
  visible: boolean;
  recipientName: string;
  sending?: boolean;
  onCancel: () => void;
  onSend: (message: string) => void;
};

export function SmsMessageModal({
  visible,
  recipientName,
  sending = false,
  onCancel,
  onSend,
}: SmsMessageModalProps) {
  const [message, setMessage] = useState('');
  const trimmedMessage = message.trim();

  useEffect(() => {
    if (!visible) {
      setMessage('');
    }
  }, [visible]);

  const handleSend = () => {
    if (!trimmedMessage || sending) {
      return;
    }

    onSend(trimmedMessage);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={sending ? undefined : onCancel}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.dialog}>
          <View style={styles.header}>
            <View style={styles.headingContainer}>
              <ThemedText style={styles.title}>Send SMS</ThemedText>
              <ThemedText style={styles.recipient} numberOfLines={1}>
                {recipientName}
              </ThemedText>
            </View>
            <TouchableOpacity
              accessibilityLabel="Close message dialog"
              accessibilityRole="button"
              disabled={sending}
              style={styles.closeButton}
              onPress={onCancel}
            >
              <AppIcon name="close" size={21} color="#374151" />
            </TouchableOpacity>
          </View>

          <TextInput
            autoFocus
            editable={!sending}
            multiline
            maxLength={500}
            placeholder="Write your message"
            placeholderTextColor="#9CA3AF"
            selectionColor="#FF8C42"
            style={styles.input}
            textAlignVertical="top"
            value={message}
            onChangeText={setMessage}
          />

          <View style={styles.footer}>
            <ThemedText style={styles.characterCount}>{message.length}/500</ThemedText>
            <TouchableOpacity
              accessibilityLabel="Send SMS"
              accessibilityRole="button"
              disabled={!trimmedMessage || sending}
              style={[
                styles.sendButton,
                (!trimmedMessage || sending) && styles.sendButtonDisabled,
              ]}
              onPress={handleSend}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <AppIcon name="send" size={18} color="#FFFFFF" />
              )}
              <ThemedText style={styles.sendButtonText}>Send</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  dialog: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    padding: 18,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  headingContainer: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  recipient: {
    marginTop: 3,
    fontSize: 13,
    color: '#6B7280',
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 130,
    maxHeight: 220,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    color: '#111827',
    fontSize: 16,
    lineHeight: 22,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  characterCount: {
    fontSize: 12,
    color: '#6B7280',
  },
  sendButton: {
    minWidth: 100,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#FF8C42',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

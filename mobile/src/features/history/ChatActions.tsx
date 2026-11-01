import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Conversation } from '@/domain/chat';
import { chatStore } from '@/state/chatStore';
import { Button, Icon, IconButton } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';

export type ChatActionSelection = {
  chat: Conversation;
  anchor: { x: number; y: number; width: number; height: number };
};

export function ChatActions({ selection, onClose }: { selection: ChatActionSelection; onClose: () => void }) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu');
  const [title, setTitle] = useState(selection.chat.title);
  const menuWidth = Math.min(232, width - 24);
  const menuHeight = 114;
  const left = Math.max(12, Math.min(selection.anchor.x + selection.anchor.width - menuWidth, width - menuWidth - 12));
  const below = selection.anchor.y + selection.anchor.height + 4;
  const top = Math.max(insets.top + 8, below + menuHeight < height - insets.bottom - 12
    ? below : selection.anchor.y - menuHeight - 4);
  const save = () => {
    if (!title.trim()) return;
    void chatStore.rename(selection.chat.id, title);
    onClose();
  };

  // One native modal hosts all three states, avoiding overlapping iOS presentations.
  return <Modal transparent visible animationType={theme.reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.backdrop, { backgroundColor: mode === 'menu' ? 'transparent' : theme.scrim }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть окно" />
      {mode === 'menu' ? <View accessibilityViewIsModal style={[styles.menu, {
        left, top, width: menuWidth, backgroundColor: theme.surface, borderColor: theme.border,
      }]}>
        <Pressable accessibilityRole="button" onPress={() => setMode('rename')}
          style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? theme.accentSoft : 'transparent' }]}>
          <Icon name="edit-2" size={18} color={theme.secondary} /><Text style={[styles.menuText, { color: theme.text }]}>Переименовать</Text>
        </Pressable>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginHorizontal: 8 }} />
        <Pressable accessibilityRole="button" onPress={() => setMode('delete')}
          style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? theme.dangerSoft : 'transparent' }]}>
          <Icon name="trash-2" size={18} color={theme.danger} /><Text style={[styles.menuText, { color: theme.danger }]}>Удалить</Text>
        </Pressable>
      </View> : <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.dialogHeader}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{mode === 'rename' ? 'Переименовать чат' : 'Удалить чат?'}</Text>
          <IconButton name="x" label="Закрыть" onPress={onClose} />
        </View>
        {mode === 'rename' ? <View style={{ gap: 18 }}>
          <TextInput autoFocus selectTextOnFocus accessibilityLabel="Название чата" placeholder="Название чата"
            placeholderTextColor={theme.muted} selectionColor={theme.accent} value={title} onChangeText={setTitle} maxLength={80}
            returnKeyType="done" onSubmitEditing={save}
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]} />
          <View style={styles.buttons}><View style={styles.button}><Button secondary onPress={onClose}>Отмена</Button></View>
            <View style={styles.button}><Button disabled={!title.trim()} onPress={save}>Сохранить</Button></View></View>
        </View> : <>
          <Text style={[styles.description, { color: theme.secondary }]}>Вы уверены, что хотите удалить чат «{selection.chat.title}»? Все его сообщения будут удалены.</Text>
          <View style={styles.buttons}><View style={styles.button}><Button secondary onPress={onClose}>Отмена</Button></View>
            <View style={styles.button}><Button danger onPress={() => { void chatStore.remove(selection.chat.id); onClose(); }}>Удалить</Button></View></View>
        </>}
      </View>}
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  menu: { position: 'absolute', padding: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18,
    boxShadow: '0 8px 28px rgba(10,30,50,0.16)' },
  menuItem: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 11 },
  menuText: { fontSize: 15, fontWeight: '500' },
  dialog: { width: '100%', maxWidth: 420, alignSelf: 'center', borderRadius: 26, padding: 22, borderWidth: StyleSheet.hairlineWidth },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  title: { flex: 1, fontSize: 21, fontWeight: '600', letterSpacing: -0.3 },
  input: { minHeight: 52, borderRadius: 13, borderWidth: 1, padding: 14, fontSize: 16 },
  description: { fontSize: 16, lineHeight: 24, marginBottom: 24 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { flex: 1, minWidth: 120 },
});

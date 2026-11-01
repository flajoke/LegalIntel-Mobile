import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Message } from '@/domain/chat';
import { Icon, LegalMark } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';

export function MessageRow({ message, isLast, onRetry, onEdit }: {
  message: Message; isLast: boolean; onRetry: () => void; onEdit: () => void;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const isUser = message.role === 'user';
  const copy = async () => {
    try { await Clipboard.setStringAsync(message.content); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  return <View style={[styles.outer, isUser ? styles.userOuter : null]}>
    {!isUser && <View style={styles.author}><LegalMark size={27} /><Text style={[styles.authorName, { color: theme.text }]}>LegalIntel</Text>
      <Text style={[styles.mode, { color: theme.secondary }]}>Демо-режим</Text></View>}
    <View style={[isUser ? styles.userBubble : styles.assistantBody, isUser && { backgroundColor: theme.bubble }]}>
      <Text selectable style={[styles.message, { color: theme.text }]}>{message.content}</Text>
    </View>
    {!isUser && <Pressable accessibilityRole="button" accessibilityLabel={copied ? 'Ответ скопирован' : 'Скопировать ответ'}
      onPress={() => void copy()} style={({ pressed }) => [styles.copy, { opacity: pressed ? 0.5 : 1 }]}>
      <Icon name={copied ? 'check' : 'copy'} size={15} color={theme.muted} />
      {copied || copyError ? <Text style={{ fontSize: 12, color: copyError ? theme.danger : theme.secondary }}>{copyError ? 'Не удалось скопировать' : 'Скопировано'}</Text> : null}
    </Pressable>}
    {message.status === 'failed' && <View style={[styles.error, { backgroundColor: theme.dangerSoft }]} accessibilityLiveRegion="polite">
      <Text style={{ color: theme.danger, fontSize: 14, lineHeight: 21 }}>{message.error || 'Не удалось получить ответ.'}</Text>
      {isLast && <View style={styles.errorActions}>
        <Pressable onPress={onRetry} accessibilityRole="button" style={styles.textAction}><Icon name="rotate-cw" size={15} color={theme.danger} /><Text style={{ color: theme.danger, fontWeight: '600' }}>Повторить</Text></Pressable>
        <Pressable onPress={onEdit} accessibilityRole="button" style={styles.textAction}><Text style={{ color: theme.danger, fontWeight: '500' }}>Изменить</Text></Pressable>
      </View>}
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  outer: { width: '100%', paddingHorizontal: 22, paddingVertical: 13, alignSelf: 'center', maxWidth: 760 },
  userOuter: { alignItems: 'flex-end', paddingVertical: 14 },
  userBubble: { maxWidth: '88%', paddingHorizontal: 18, paddingVertical: 13, borderRadius: 22, borderTopRightRadius: 7 },
  assistantBody: { paddingTop: 13 },
  author: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
  authorName: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  mode: { fontSize: 11, letterSpacing: 0.15 },
  message: { fontSize: 16, lineHeight: 25 },
  copy: { flexDirection: 'row', gap: 7, alignItems: 'center', minHeight: 44, minWidth: 44, alignSelf: 'flex-start' },
  error: { alignSelf: 'stretch', marginTop: 12, padding: 14, borderRadius: 15 },
  errorActions: { flexDirection: 'row', gap: 24, marginTop: 4 },
  textAction: { minHeight: 44, flexDirection: 'row', gap: 7, alignItems: 'center' },
});

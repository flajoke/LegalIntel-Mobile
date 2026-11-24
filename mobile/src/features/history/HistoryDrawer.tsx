import { useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, SectionList, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Conversation } from '@/domain/chat';
import { chatStore, useChatState } from '@/state/chatStore';
import { Icon, IconButton, LegalMark } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';
import { ChatActions, type ChatActionSelection } from './ChatActions';

function groupName(iso: string) {
  const date = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  return date >= today ? 'Сегодня' : date >= yesterday ? 'Вчера' : 'Ранее';
}

export function HistoryDrawer({ onClose, showClose }: { onClose: () => void; showClose?: boolean }) {
  const theme = useTheme();
  const { data } = useChatState();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [actionSelection, setActionSelection] = useState<ChatActionSelection | null>(null);
  const sections = useMemo(() => {
    const filtered = [...data.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter(c => `${c.title} ${c.messages.map(m => m.content).join(' ')}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
    return ['Сегодня', 'Вчера', 'Ранее'].map(label => ({ title: label, data: filtered.filter(c => groupName(c.updatedAt) === label) })).filter(s => s.data.length);
  }, [data.conversations, query]);
  const openChat = (id: string | null) => { Keyboard.dismiss(); chatStore.select(id); onClose(); };

  return <SafeAreaView style={[styles.root, { backgroundColor: theme.sidebar }]} edges={['top', 'bottom', 'left']}>
    <View style={styles.top}><LegalMark size={33} /><Text style={{ flex: 1, fontSize: 20, fontWeight: '600', letterSpacing: -0.6, color: theme.text }}>LegalIntel</Text>
      {(showClose || width < 1000) && <IconButton name="x" label="Закрыть историю" onPress={onClose} />}</View>
    <Pressable accessibilityRole="button" accessibilityLabel="Новый чат" onPress={() => openChat(null)} style={({ pressed }) => [styles.newChat, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
      <Icon name="plus" size={20} color={theme.accent} /><Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>Новый чат</Text></Pressable>
    <View style={[styles.search, { backgroundColor: theme.bubble }]}><Icon name="search" size={16} color={theme.muted} />
      <TextInput accessibilityLabel="Поиск по чатам" placeholder="Поиск по чатам" placeholderTextColor={theme.muted} value={query} onChangeText={setQuery}
        style={{ flex: 1, minHeight: 44, color: theme.text, fontSize: 14 }} clearButtonMode="while-editing" />
      {!!query && <IconButton name="x" label="Очистить поиск" onPress={() => setQuery('')} />}</View>
    <SectionList sections={sections} keyExtractor={chat => chat.id} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 18 }}
      indicatorStyle={theme.dark ? 'white' : 'black'} stickySectionHeadersEnabled={false} keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <ChatRow chat={item} active={data.activeId === item.id} onOpen={() => openChat(item.id)} onActions={setActionSelection} />}
      renderSectionHeader={({ section }) => <Text style={[styles.group, { color: theme.muted }]}>{section.title}</Text>}
      ListEmptyComponent={<View style={styles.empty}><Icon name={query ? 'search' : 'message-circle'} size={25} color={theme.muted} />
        <Text style={{ textAlign: 'center', color: theme.secondary, lineHeight: 22 }}>{query ? 'Чаты не найдены' : 'Здесь будут ваши диалоги'}</Text></View>} />
    <View style={[styles.bottom, { borderTopColor: theme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Правовая база" onPress={() => { Keyboard.dismiss(); if (showClose) router.replace('/knowledge'); else router.push('/knowledge'); }} style={styles.settings}>
        <View style={[styles.settingsIcon, { backgroundColor: theme.bubble }]}><Icon name="book-open" size={19} /></View>
        <Text style={{ flex: 1, color: theme.text, fontSize: 15 }}>Правовая база</Text><Icon name="chevron-right" size={17} color={theme.muted} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Настройки" onPress={() => { Keyboard.dismiss(); onClose(); router.push('/settings'); }} style={styles.settings}>
        <View style={[styles.settingsIcon, { backgroundColor: theme.bubble }]}><Icon name="settings" size={19} /></View>
        <Text style={{ flex: 1, color: theme.text, fontSize: 15 }}>Настройки</Text><Icon name="chevron-right" size={17} color={theme.muted} /></Pressable>
    </View>

    {actionSelection && <ChatActions selection={actionSelection} onClose={() => setActionSelection(null)} />}
  </SafeAreaView>;
}

function ChatRow({ chat, active, onOpen, onActions }: {
  chat: Conversation; active: boolean; onOpen: () => void; onActions: (selection: ChatActionSelection) => void;
}) {
  const theme = useTheme();
  const anchor = useRef<View>(null);
  const openActions = () => {
    Keyboard.dismiss();
    anchor.current?.measureInWindow((x, y, width, height) => onActions({ chat, anchor: { x, y, width, height } }));
  };
  return <View style={[styles.chat, { backgroundColor: active ? theme.accentSoft : 'transparent' }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Открыть чат: ${chat.title}`} accessibilityState={{ selected: active }}
      onPress={onOpen} onLongPress={openActions} style={({ pressed }) => [styles.chatMain, { opacity: pressed ? 0.55 : 1 }]}>
      <Icon name="message-square" size={17} color={active ? theme.accent : theme.secondary} />
      <View style={{ flex: 1, gap: 5 }}><Text numberOfLines={2} style={{ color: theme.text, fontSize: 14, lineHeight: 20, fontWeight: active ? '600' : '400' }}>{chat.title}</Text>
        <Text style={{ color: theme.muted, fontSize: 11 }}>{new Date(chat.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</Text></View>
    </Pressable>
    <View ref={anchor} collapsable={false}><IconButton name="more-horizontal" label={`Действия с чатом: ${chat.title}`} onPress={openActions} /></View>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, top: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 18, paddingBottom: 22 },
  newChat: { flexDirection: 'row', alignItems: 'center', gap: 11, marginHorizontal: 18, minHeight: 52, padding: 15, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  search: { marginHorizontal: 18, marginTop: 16, marginBottom: 7, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12 },
  group: { fontSize: 12, fontWeight: '500', letterSpacing: 0.2, paddingHorizontal: 12, paddingTop: 24, paddingBottom: 9 },
  chat: { flexDirection: 'row', alignItems: 'center', borderRadius: 13, marginVertical: 2, paddingRight: 2 },
  chatMain: { flexDirection: 'row', alignItems: 'center', flex: 1, minHeight: 68, gap: 12, padding: 12 },
  empty: { gap: 14, alignItems: 'center', paddingHorizontal: 25, paddingTop: 55 },
  bottom: { padding: 18, borderTopWidth: StyleSheet.hairlineWidth },
  settings: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  settingsIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chatStore, useChatState } from '@/state/chatStore';
import type { ThemePreference } from '@/domain/chat';
import { Button, ConfirmButton, Icon, IconButton, LegalMark } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';
import { AccountPanel } from '@/features/account/AccountPanel';

export function SettingsScreen() {
  const theme = useTheme();
  const { data, storageError } = useChatState();
  const preferences: { value: ThemePreference; label: string; icon: 'smartphone' | 'sun' | 'moon' }[] = [
    { value: 'system', label: 'Системная тема', icon: 'smartphone' },
    { value: 'light', label: 'Светлая', icon: 'sun' },
    { value: 'dark', label: 'Тёмная', icon: 'moon' },
  ];

  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
    <View style={styles.header}><Text accessibilityRole="header" style={{ fontSize: 23, fontWeight: '600', letterSpacing: -0.6, color: theme.text }}>Настройки</Text>
      <IconButton name="x" label="Закрыть настройки" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} /></View>
    <ScrollView indicatorStyle={theme.dark ? 'white' : 'black'} contentContainerStyle={styles.content}>
      <View style={styles.about}><LegalMark size={47} /><View style={{ flex: 1, gap: 6 }}><Text style={{ color: theme.text, fontSize: 20, fontWeight: '600', letterSpacing: -0.4 }}>LegalIntel</Text>
      </View></View>
      <AccountPanel />
      <Text style={[styles.label, { color: theme.secondary }]}>ОФОРМЛЕНИЕ</Text>
      <View style={[styles.card, { backgroundColor: theme.surface }]}>{preferences.map((preference, i) => <Pressable key={preference.value} accessibilityRole="radio" accessibilityLabel={preference.label}
        accessibilityState={{ checked: data.settings.theme === preference.value }} onPress={() => void chatStore.saveSettings({ ...data.settings, theme: preference.value })}
        style={({ pressed }) => [styles.themeRow, { opacity: pressed ? 0.65 : 1, borderBottomWidth: i < 2 ? StyleSheet.hairlineWidth : 0, borderBottomColor: theme.border }]}>
        <Icon name={preference.icon} size={19} color={theme.secondary} /><Text style={{ flex: 1, color: theme.text, fontSize: 16 }}>{preference.label}</Text>
        {data.settings.theme === preference.value && <Icon name="check" size={20} color={theme.accent} />}</Pressable>)}</View>

      <Text style={[styles.label, { color: theme.secondary }]}>ИСТОРИЯ</Text>
      <View style={[styles.historyCard, { backgroundColor: theme.surface }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="message-square" size={18} color={theme.secondary} />
          <Text style={{ color: theme.text, fontSize: 16 }}>Всего чатов: {data.conversations.length}</Text></View>
        <ConfirmButton label="Удалить все чаты" title="Удалить всю историю?" disabled={!data.conversations.length && !data.newDraft}
          description="Все диалоги, сообщения и черновики этого аккаунта будут удалены на устройстве и при синхронизации на сервере. Это действие нельзя отменить."
          action={() => void chatStore.clearChats()} />
      </View>
      {storageError && <View accessibilityLiveRegion="assertive" style={{ gap: 10, marginTop: 18 }}><Text style={{ color: theme.danger, lineHeight: 21 }}>{storageError}</Text><Button secondary onPress={() => void chatStore.retrySave()}>Повторить сохранение</Button></View>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 12 },
  content: { width: '100%', maxWidth: 620, alignSelf: 'center', padding: 22, paddingBottom: 38 },
  about: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 5 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 1.3, marginTop: 31, marginBottom: 12, marginLeft: 3 },
  card: { borderRadius: 18, paddingHorizontal: 17, overflow: 'hidden' },
  themeRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 14 },
  historyCard: { borderRadius: 18, padding: 18, gap: 14 },
});

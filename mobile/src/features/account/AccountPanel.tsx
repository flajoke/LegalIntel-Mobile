import { useEffect } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { authStore, useAuthState } from '@/state/authStore';
import { accountSync, useAccountSync } from '@/state/accountSync';
import { Button, ConfirmButton } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';

export function AccountPanel() {
  const auth = useAuthState(), sync = useAccountSync(), theme = useTheme();
  const busy = auth.busy || sync.status === 'syncing';
  return <View style={{ padding: 18, gap: 13, marginTop: 22, borderWidth: 1, borderColor: theme.border, borderRadius: 18, backgroundColor: theme.surface }}>
    <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 18, fontWeight: '600' }}>Аккаунт · {auth.user?.username}</Text>
    <Text accessibilityLiveRegion="polite" style={{ color: sync.status === 'conflict' || sync.status === 'offline' ? theme.danger : theme.secondary, lineHeight: 22 }}>{sync.message}</Text>
    {sync.savedAt && <Text style={{ color: theme.secondary, fontSize: 12 }}>Сохранение на сервере: {new Date(sync.savedAt).toLocaleString('ru-RU')}</Text>}
    <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 20 }}>Синхронизация при входе, изменениях и возврате в приложение. Для проверки на втором устройстве нажмите кнопку ниже. Без связи изменения остаются в локальной копии этого аккаунта.</Text>
    {sync.status === 'conflict' ? <>
      <Text style={{ color: theme.text, lineHeight: 22 }}>Обе версии сохранятся. Различающиеся чаты получат отдельную «локальную копию»; удалённые на одном устройстве чаты могут вернуться из другой версии.</Text>
      <Button disabled={busy} onPress={() => void accountSync.mergeConflict()}>Сохранить обе версии</Button>
    </> : <Button secondary disabled={busy} onPress={() => void accountSync.refresh()}>Синхронизировать</Button>}
    {sync.legacyCount > 0 && <ConfirmButton label={`Перенести старые локальные чаты (${sync.legacyCount})`} title="Перенести историю в этот аккаунт?"
      description={`Чаты до появления аккаунтов будут добавлены в аккаунт ${auth.user?.username}. Исходная локальная копия сохранится. В других аккаунтах она показываться не будет.`}
      disabled={busy || sync.status === 'conflict'} action={() => void accountSync.importLegacy()} />}
    {!!auth.error && <Text accessibilityLiveRegion="assertive" style={{ color: theme.danger, lineHeight: 22 }}>{auth.error}</Text>}
    <Button secondary disabled={busy} onPress={() => void authStore.logout()}>Выйти из аккаунта</Button>
  </View>;
}

export function SyncStatus() {
  const sync = useAccountSync(), theme = useTheme();
  useEffect(() => {
    if (Platform.OS === 'web') {
      const focus = () => { void accountSync.refresh(); };
      window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus);
    }
    const sub = AppState.addEventListener('change', value => { if (value === 'active') void accountSync.refresh(); });
    return () => sub.remove();
  }, []);
  return <Pressable accessibilityRole="button" accessibilityLabel="Открыть аккаунт и синхронизацию" onPress={() => router.push('/settings')} style={{ minHeight: 32, justifyContent: 'center', paddingVertical: 5 }}>
    <Text numberOfLines={2} style={{ textAlign: 'center', fontSize: 11, color: sync.status === 'conflict' || sync.status === 'offline' ? theme.danger : theme.muted }}>{sync.message}</Text>
  </Pressable>;
}

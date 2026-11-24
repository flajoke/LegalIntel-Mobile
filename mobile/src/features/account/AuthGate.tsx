import { useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import Feather from '@expo/vector-icons/Feather';
import * as SplashScreen from 'expo-splash-screen';
import { authStore, useAuthState } from '@/state/authStore';
import { Button, LegalMark } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';

export function AuthGate({ children }: PropsWithChildren) {
  const state = useAuthState();
  const theme = useTheme();
  const [fonts, fontError] = useFonts(Feather.font);
  useEffect(() => { void authStore.initialize(); }, []);
  useEffect(() => { if (fonts || fontError) void SplashScreen.hideAsync(); }, [fonts, fontError]);
  if (state.status === 'authenticated') return <>{children}</>;
  if (state.status === 'loading' || (!fonts && !fontError)) return <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 }}>
    <LegalMark size={58} /><ActivityIndicator color={theme.accent} /><Text style={{ color: theme.secondary, lineHeight: 23, textAlign: 'center' }}>Проверяем вход…</Text>
  </View>;
  return <AuthForm />;
}

function AuthForm() {
  const state = useAuthState();
  const theme = useTheme();
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const submit = () => {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{2,31}$/.test(username.trim())) { setError('Логин: 3–32 символа, латинские буквы, цифры, точка, дефис или _. Первый символ — буква.'); return; }
    if (password.length < 10 || password.length > 128) { setError('Пароль должен содержать от 10 до 128 символов.'); return; }
    if (register && repeat !== password) { setError('Пароли не совпадают.'); return; }
    setError(''); void authStore.login(username, password, register); setPassword(''); setRepeat('');
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
      <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center', gap: 16 }}>
        <LegalMark size={52} /><Text accessibilityRole="header" style={{ color: theme.text, fontSize: 28, fontWeight: '600' }}>LegalIntel</Text>
        <Text style={{ color: theme.text, fontSize: 20, fontWeight: '600' }}>{register ? 'Создать аккаунт' : 'Войти в аккаунт'}</Text>
        <Text style={{ color: theme.secondary, lineHeight: 22 }}>Сохраняйте чаты и обращения, чтобы вернуться к ним позже.</Text>
        <Text style={{ color: theme.secondary, fontSize: 12 }}>Логин</Text>
        <TextInput accessibilityLabel="Логин" value={username} onChangeText={setUsername} editable={!state.busy} autoCapitalize="none" autoCorrect={false} maxLength={32}
          textContentType="username" style={{ minHeight: 50, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 14, color: theme.text, fontSize: 16 }} />
        <Text style={{ color: theme.secondary, fontSize: 12 }}>Пароль · не менее 10 символов</Text>
        <TextInput accessibilityLabel="Пароль" value={password} onChangeText={setPassword} editable={!state.busy} secureTextEntry autoCapitalize="none" maxLength={128}
          textContentType={register ? 'newPassword' : 'password'} onSubmitEditing={submit} style={{ minHeight: 50, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 14, color: theme.text, fontSize: 16 }} />
        {register && <><Text style={{ color: theme.secondary, fontSize: 12 }}>Повторите пароль</Text><TextInput accessibilityLabel="Повторите пароль" value={repeat} onChangeText={setRepeat} editable={!state.busy} secureTextEntry autoCapitalize="none" maxLength={128}
          onSubmitEditing={submit} style={{ minHeight: 50, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 14, color: theme.text, fontSize: 16 }} /></>}
        {!!(error || state.error) && <Text accessibilityLiveRegion="assertive" style={{ color: theme.danger, lineHeight: 22 }}>{error || state.error}</Text>}
        <Button disabled={state.busy} onPress={submit}>{state.busy ? 'Подключаем…' : register ? 'Создать аккаунт' : 'Войти'}</Button>
        <Button secondary disabled={state.busy} onPress={() => { setRegister(v => !v); setError(''); }}>{register ? 'Уже есть аккаунт' : 'Создать аккаунт'}</Button>
        <Pressable accessibilityRole="button" disabled={state.busy} onPress={() => void authStore.initialize()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.accent, textAlign: 'center' }}>Попробовать снова</Text></Pressable>
        {register && <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 20 }}>Сохраните пароль: восстановление пароля пока недоступно. Старые чаты можно перенести в настройках после входа.</Text>}
      </View>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}

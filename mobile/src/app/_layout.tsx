import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import Feather from '@expo/vector-icons/Feather';
import { chatStore, useChatState } from '@/state/chatStore';
import { ThemeProvider, useTheme } from '@/ui/theme';
import { Button, ConfirmButton, LegalMark } from '@/ui/Primitives';
import { AuthGate } from '@/features/account/AuthGate';

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const theme = useTheme();
  const state = useChatState();
  const [fontsLoaded, fontError] = useFonts(Feather.font);
  useEffect(() => { void chatStore.initialize(); }, []);
  useEffect(() => {
    if ((fontsLoaded || fontError) && (state.ready || state.loadError)) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError, state.ready, state.loadError]);
  if (fontError) throw fontError;
  if (!fontsLoaded || !state.ready) return <View style={[styles.boot, { backgroundColor: theme.background }]}>
    <LegalMark size={62} /><Text style={[styles.brand, { color: theme.text }]}>LegalIntel</Text>
    {state.loadError ? <View style={{ width: '100%', maxWidth: 340, gap: 14 }}>
      <Text style={{ color: theme.secondary, textAlign: 'center', lineHeight: 23 }}>{state.loadError}</Text>
      <Button onPress={() => void chatStore.initialize()}>Попробовать снова</Button>
      <ConfirmButton label="Удалить локальные данные" title="Удалить сохранённые чаты?"
        description="Все чаты на этом устройстве будут удалены. Это действие нельзя отменить."
        action={() => void chatStore.resetUnreadable()} />
    </View> : <ActivityIndicator color={theme.accent} accessibilityLabel="Загрузка чатов" />}
  </View>;
  return <><StatusBar style={theme.dark ? 'light' : 'dark'} /><Stack screenOptions={{
    headerShown: false, contentStyle: { backgroundColor: theme.background }, animation: theme.reduceMotion ? 'none' : 'default',
  }}>
    <Stack.Screen name="(chat)" />
    <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
    <Stack.Screen name="history" options={{ animation: 'none' }} />
    <Stack.Screen name="knowledge" />
    <Stack.Screen name="analysis" />
    <Stack.Screen name="documents" />
  </Stack></>;
}

export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><ThemeProvider><AuthGate><RootNavigator /></AuthGate></ThemeProvider></SafeAreaProvider></GestureHandlerRootView>;
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  useEffect(() => { void SplashScreen.hideAsync(); }, []);
  return <View style={[styles.boot, { backgroundColor: '#F7FAFD' }]}>
    <Text style={styles.brand}>LegalIntel</Text><Text style={{ textAlign: 'center', lineHeight: 24 }}>Не удалось открыть приложение. Попробуйте ещё раз.</Text>
    <Button onPress={() => void retry()}>Повторить</Button>
  </View>;
}

const styles = StyleSheet.create({ boot: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 20 }, brand: { fontSize: 28, fontWeight: '600', letterSpacing: -0.8 } });

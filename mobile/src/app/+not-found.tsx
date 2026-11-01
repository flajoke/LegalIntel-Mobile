import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Button } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';

export default function NotFound() {
  const theme = useTheme();
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 20, backgroundColor: theme.background }}>
    <Text style={{ fontSize: 24, color: theme.text }}>Такого экрана нет</Text>
    <Button onPress={() => router.replace('/')}>Вернуться к чату</Button>
  </View>;
}

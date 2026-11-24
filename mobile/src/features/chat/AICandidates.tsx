import { Text, View } from 'react-native';
import type { AICandidate, AIAction } from '@/domain/ai';
import { Button } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';

export function AICandidates({ values, disabled, onAction }: {
  values: AICandidate[]; disabled: boolean; onAction: (action: AIAction, label: string) => void;
}) {
  const theme = useTheme();
  if (!values.length) return null;
  return <View style={{ width: '100%', maxWidth: 730, alignSelf: 'center', padding: 18 }}>
    <View style={{ padding: 18, borderRadius: 20, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, gap: 14 }}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontWeight: '600', fontSize: 17 }}>Верно ли я понял?</Text>
      <Text style={{ color: theme.secondary, fontSize: 13, lineHeight: 20 }}>Проверьте сведения перед сохранением. Если что-то не так, напишите уточнение в чат.</Text>
      {values.map(item => <View key={item.field} style={{ paddingTop: 12, borderTopWidth: 0.5, borderColor: theme.border, gap: 5 }}>
        <Text style={{ color: theme.secondary, fontSize: 12 }}>{item.label}</Text>
        <Text selectable style={{ color: theme.text, fontSize: 15, lineHeight: 22 }}>{item.display_value}</Text>
        {item.previous_value !== null && <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 18 }}>Ранее: {item.previous_value}</Text>}
        <Text selectable style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>Из сообщения: «{item.evidence}»</Text>
      </View>)}
      <Button disabled={disabled} onPress={() => onAction('accept', 'Подтверждаю предложенные сведения')}>Сохранить сведения</Button>
      <Button secondary disabled={disabled} onPress={() => onAction('dismiss', 'Не сохранять предложенные сведения')}>Не сохранять</Button>
    </View>
  </View>;
}

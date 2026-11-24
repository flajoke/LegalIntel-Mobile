import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SalaryQuestion } from '@/domain/salary';
import { Button, Icon } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';

export function answerLabel(question: SalaryQuestion, value: string | null) {
  if (value === null) return 'Не знаю';
  if (question.kind === 'choice' || question.kind === 'multi') {
    return question.options.filter(option => value.split(',').includes(option.value)).map(option => option.label).join(', ');
  }
  return value;
}

export function QuestionForm({ question, value, onChange, onAnswer, disabled, editing = false }: {
  question: SalaryQuestion; value: string; onChange: (value: string) => void;
  onAnswer: (value: string | null) => void; disabled?: boolean; editing?: boolean;
}) {
  const theme = useTheme();
  const multi = question.kind === 'multi';
  const choice = question.kind === 'choice' || multi;
  const toggle = (option: string) => {
    if (!multi) { if (editing) onChange(option); else onAnswer(option); return; }
    const selected = value ? value.split(',') : [];
    onChange(option === 'none' ? 'none' : selected.includes(option)
      ? selected.filter(v => v !== option).join(',') : [...selected.filter(v => v !== 'none'), option].join(','));
  };
  return <View style={{ gap: 10 }}>
    {!!question.hint && <Text style={{ fontSize: 13, lineHeight: 19, color: theme.secondary }}>{question.hint}</Text>}
    {choice ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {question.options.map(option => {
        const selected = value.split(',').includes(option.value);
        return <Pressable key={option.value} disabled={disabled} accessibilityRole={multi ? 'checkbox' : 'button'}
          accessibilityState={{ disabled: !!disabled, ...(multi ? { checked: selected } : { selected }) }}
          onPress={() => toggle(option.value)} style={({ pressed }) => [styles.choice, {
            backgroundColor: selected || pressed ? theme.accentSoft : theme.surface,
            borderColor: selected ? theme.accent : theme.border, opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
          }]}>
          {multi && <Icon name={selected ? 'check-square' : 'square'} size={17} color={selected ? theme.accent : theme.secondary} />}
          <Text style={{ color: selected ? theme.accent : theme.text, fontSize: 14, lineHeight: 20, flexShrink: 1 }}>{option.label}</Text>
        </Pressable>;
      })}
    </View> : <TextInput value={value} onChangeText={onChange} editable={!disabled} accessibilityLabel={question.label}
      placeholder={question.kind === 'date' ? 'ДД.ММ.ГГГГ' : question.kind === 'money' ? 'Сумма в рублях' : 'Ваш ответ'}
      placeholderTextColor={theme.muted} maxLength={question.kind === 'text' ? 240 : 40}
      keyboardType={question.kind === 'money' ? 'decimal-pad' : 'default'} returnKeyType="done" autoCorrect={question.kind === 'text'}
      onSubmitEditing={() => { if (!disabled && value.trim()) onAnswer(value.trim()); }}
      style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]} />}
    {(!choice || multi || editing) && <Button disabled={disabled || !value.trim()} onPress={() => onAnswer(value.trim())}>
      {editing ? 'Сохранить' : 'Продолжить'}
    </Button>}
    {question.allow_unknown && <Pressable disabled={disabled} accessibilityRole="button" onPress={() => onAnswer(null)}
      style={({ pressed }) => ({ minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : pressed ? 0.55 : 1 })}>
      <Text style={{ color: theme.secondary, fontSize: 14 }}>Не знаю</Text>
    </Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  choice: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 11, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  input: { minHeight: 50, padding: 14, borderRadius: 14, borderWidth: 1, fontSize: 16 },
});

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { readableDate, type LegalSource, type SalaryAction, type SalaryCase, type SalaryQuestion } from '@/domain/salary';
import { Button, Dialog, Icon } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';
import { SourceViewer } from '@/features/knowledge/SourceViewer';
import { answerLabel, QuestionForm } from './QuestionForm';

export function SalarySummary({ value, disabled, onAction, onAnalyze, onDocuments }: { value: SalaryCase; disabled: boolean; onAction: (action: SalaryAction, label: string) => void; onAnalyze?: () => void; onDocuments?: () => void }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [allSources, setAllSources] = useState(false);
  const [editing, setEditing] = useState<SalaryQuestion | null>(null);
  const [source, setSource] = useState<LegalSource | null>(null);
  const full = expanded || value.status !== 'collecting';
  const complete = value.status === 'complete';
  return <View style={{ maxWidth: 730, width: '100%', alignSelf: 'center', padding: 18, gap: 14 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: full }} onPress={() => setExpanded(v => !v)}
      disabled={value.status !== 'collecting'} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10 }}>
      <Icon name={complete ? 'check-circle' : 'clipboard'} color={theme.accent} />
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 17, fontWeight: '600', flex: 1 }}>{complete ? 'Сведения подтверждены' : 'Сведения по выплате'}</Text>
      {value.status === 'collecting' && <Icon name={full ? 'chevron-up' : 'chevron-down'} color={theme.secondary} />}
    </Pressable>
    {full && <>
      <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 18, paddingHorizontal: 15, backgroundColor: theme.surface }}>
        {value.summary.map((row, i) => <Pressable key={row.field} disabled={disabled} accessibilityRole="button"
          accessibilityLabel={`Изменить: ${row.label}. ${row.value}`} onPress={() => setEditing(value.fields.find(f => f.field === row.field) ?? null)}
          style={({ pressed }) => ({ minHeight: 66, paddingVertical: 13, borderTopWidth: i ? 0.5 : 0, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: disabled ? 0.5 : pressed ? 0.65 : 1 })}>
          <View style={{ flex: 1, gap: 5 }}><Text style={{ color: theme.secondary, fontSize: 12 }}>{row.label}</Text><Text style={{ color: theme.text, fontSize: 14, lineHeight: 21 }}>{row.value}</Text></View>
          <Icon name="edit-2" size={15} color={theme.muted} />
        </Pressable>)}
      </View>
      {value.status !== 'outside_scope' && <View style={{ backgroundColor: theme.accentSoft, padding: 16, borderRadius: 16, gap: 8 }}>
        <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '600' }}>По вашим данным на {readableDate(value.metrics.as_of_date)}</Text>
        <Text style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>Дней после указанного срока: {value.metrics.delay_days ?? 'недостаточно данных'}{'\n'}
          Остаток выплаты: {value.metrics.remaining_amount === null ? 'неизвестен' : `${Number(value.metrics.remaining_amount).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`}</Text>
        <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 18 }}>Дни рассчитаны по введённым датам; при полной выплате — до даты расчёта. Это арифметика, а не вывод о нарушении или расчёт компенсации.</Text>
      </View>}
      {value.notices.map(notice => <Text key={notice} style={{ color: theme.secondary, fontSize: 13, lineHeight: 20 }}>{notice}</Text>)}
      {value.status === 'review' && <Button disabled={disabled} onPress={() => onAction({ kind: 'confirm' }, 'Подтверждаю введённые сведения')}>Подтвердить сведения</Button>}
      {complete && onAnalyze && <View style={{ gap: 8 }}>
        <Button disabled={disabled} onPress={onAnalyze}>Посмотреть анализ выплаты</Button>
        <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 18 }}>Предварительная оценка по подтверждённым сведениям. Работает без AI.</Text>
      </View>}
      {onDocuments && <Button secondary disabled={disabled} onPress={onDocuments}>Обращения по этому чату</Button>}
      {!!value.sources.length && <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 17, fontWeight: '600', marginTop: 12 }}>Нормы по теме</Text>
        <Text style={{ color: theme.secondary, fontSize: 13, lineHeight: 20 }}>Подборка для изучения. Применимость норм, исключения и ответственность требуют отдельной оценки. Проверено {readableDate(value.corpus.checked_on)}.</Text>
        {(allSources ? value.sources : value.sources.slice(0, 3)).map(item => <Pressable key={item.id} accessibilityRole="button"
          accessibilityLabel={`Прочитать ${item.citation}`} onPress={() => setSource(item)} style={({ pressed }) => ({
            padding: 15, gap: 7, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: pressed ? theme.accentSoft : theme.surface,
          })}>
          <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '600' }}>{item.citation}</Text>
          <Text style={{ color: theme.text, fontSize: 14, lineHeight: 21 }}>{item.title}</Text>
          <Text numberOfLines={2} style={{ color: theme.secondary, fontSize: 12, lineHeight: 19 }}>{item.excerpt}</Text>
          <Text style={{ color: theme.accent, fontSize: 12 }}>Прочитать статью целиком</Text>
        </Pressable>)}
        {value.sources.length > 3 && <Button secondary onPress={() => setAllSources(v => !v)}>{allSources ? 'Свернуть' : `Все источники (${value.sources.length})`}</Button>}
      </View>}
    </>}
    {editing && <EditAnswer question={editing} initial={value.answers[editing.field] ?? ''} onClose={() => setEditing(null)} onSave={answer => {
      onAction({ kind: 'edit', field: editing.field, value: answer }, `${editing.label}: ${answerLabel(editing, answer)}`); setEditing(null);
    }} />}
    {source && <SourceViewer source={source} onClose={() => setSource(null)} />}
  </View>;
}

function EditAnswer({ question, initial, onClose, onSave }: { question: SalaryQuestion; initial: string; onClose: () => void; onSave: (value: string | null) => void }) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const [value, setValue] = useState(question.kind === 'date' ? readableDate(initial) : initial);
  return <Dialog visible title={question.label} onClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ maxHeight: height * 0.6 }} keyboardShouldPersistTaps="handled" indicatorStyle={theme.dark ? 'white' : 'black'} contentContainerStyle={{ gap: 14 }}>
        <Text style={{ color: theme.text, lineHeight: 23 }}>{question.prompt}</Text>
        <QuestionForm question={question} value={value} onChange={setValue} onAnswer={onSave} editing />
      </ScrollView>
    </KeyboardAvoidingView>
  </Dialog>;
}

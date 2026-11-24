import { useEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { caseFingerprint, defaultAnalysisOptions, isAnalysisOptions, type AnalysisItem, type AnalysisOptions, type SalaryAnalysis } from '@/domain/analysis';
import type { Conversation } from '@/domain/chat';
import { readableDate, type LegalSource, type SalaryCase } from '@/domain/salary';
import { SourceViewer } from '@/features/knowledge/SourceViewer';
import { analyzeSalary } from '@/services/api';
import { chatStore, useChatState } from '@/state/chatStore';
import { Button, Icon, IconButton } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';

const rubles = (value: string | null) => value === null ? 'Не определён' : `${Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const back = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };

export function SalaryAnalysisScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId?: string }>();
  const { data } = useChatState();
  const theme = useTheme();
  const chat = data.conversations.find(c => c.id === conversationId);
  const value = chat?.salaryCase;
  const blocked = !value?.confirmed || value.status !== 'complete' || !!chat?.aiCandidates?.length
    || chat?.messages.at(-1)?.status === 'pending' || chat?.messages.at(-1)?.status === 'failed';
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <View style={{ width: '100%', maxWidth: 800, alignSelf: 'center', flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
        <IconButton name="arrow-left" label="Назад к сведениям" onPress={back} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 21, fontWeight: '600' }}>Анализ выплаты</Text>
          <Text numberOfLines={1} style={{ color: theme.secondary, fontSize: 12 }}>{chat?.title ?? 'Кейс не найден'}</Text>
        </View>
      </View>
      {chat && value && !blocked ? <AnalysisContent key={`${chat.id}:${caseFingerprint(value)}`} chat={chat} value={value} />
        : <View style={{ padding: 24, gap: 16 }}>
          <Text style={{ color: theme.text, fontSize: 17, lineHeight: 25 }}>{!chat ? 'Этот чат не найден на устройстве.' : 'Сначала завершите текущий запрос, проверьте предложенные факты и подтвердите сведения в чате.'}</Text>
          <Button secondary onPress={back}>Вернуться к чату</Button>
        </View>}
    </View>
  </SafeAreaView>;
}

function AnalysisContent({ chat, value }: { chat: Conversation; value: SalaryCase }) {
  const theme = useTheme();
  const { storageError } = useChatState();
  const fingerprint = caseFingerprint(value);
  const saved = chat.salaryAnalysis?.caseFingerprint === fingerprint ? chat.salaryAnalysis.options : defaultAnalysisOptions();
  const [draft, setDraft] = useState<AnalysisOptions>(saved);
  const [submitted, setSubmitted] = useState<AnalysisOptions>(saved);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<SalaryAnalysis | null>(null);
  const [error, setError] = useState('');
  const [inputError, setInputError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [refine, setRefine] = useState(false);
  const [periods, setPeriods] = useState(false);
  const [source, setSource] = useState<LegalSource | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(submitted);
  const serialized = JSON.stringify(submitted);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    analyzeSalary(chat.id, value, JSON.parse(serialized) as AnalysisOptions, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Не удалось получить анализ.'); });
    return () => controller.abort();
  }, [chat.id, fingerprint, serialized, attempt]);
  const set = (patch: Partial<AnalysisOptions>) => { setDraft(current => ({ ...current, ...patch })); setInputError(''); };
  const submit = () => {
    const clean: AnalysisOptions = { ...draft, payments: draft.payments.map(p => ({ date: p.date.trim(), amount: p.amount.replace(/\s/g, '').replace(',', '.') })) };
    if (!isAnalysisOptions(clean)) { setInputError('Укажите даты выплат как ГГГГ-ММ-ДД и положительные суммы в рублях, не более двух знаков после запятой.'); return; }
    setDraft(clean); setSubmitted(clean); setAttempt(v => v + 1); setInputError(''); setRefine(false);
    void chatStore.saveAnalysisOptions(chat.id, fingerprint, clean);
  };
  const openSource = (id: string) => { const found = data?.sources.find(s => s.id === id); if (found) setSource(found); };
  const citations = (ids: string[]) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{ids.map(id => {
    const found = data?.sources.find(s => s.id === id);
    return found ? <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Прочитать ${found.citation}`} onPress={() => openSource(id)}
      style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', borderRadius: 10, paddingHorizontal: 10, backgroundColor: pressed ? theme.bubble : theme.accentSoft })}>
      <Text style={{ color: theme.accent, fontSize: 12 }}>{found.citation}</Text>
    </Pressable> : null;
  })}</View>;
  const visible = dirty ? null : data;
  return <>
    <ScrollView style={{ flex: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" indicatorStyle={theme.dark ? 'white' : 'black'} contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 36, gap: 18 }}>
      <Text style={{ color: theme.secondary, fontSize: 13, lineHeight: 20 }}>По подтверждённым сведениям на {readableDate(value.metrics.as_of_date)}. Работает без AI.</Text>
      {storageError && <Card><Text accessibilityLiveRegion="assertive" style={{ color: theme.danger, lineHeight: 21 }}>{storageError}</Text><Button secondary onPress={() => void chatStore.retrySave()}>Повторить сохранение</Button></Card>}
      {visible ? <Card accent>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <Icon name={['possible_delay', 'paid_late', 'needs_review'].includes(visible.status) ? 'alert-circle' : 'clipboard'} color={theme.accent} size={25} />
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>ПРЕДВАРИТЕЛЬНАЯ ОЦЕНКА</Text>
            <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 23, lineHeight: 30, fontWeight: '600' }}>{visible.title}</Text>
          </View>
        </View>
        <Text style={{ color: theme.text, fontSize: 15, lineHeight: 24 }}>{visible.summary}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 4 }}>
          <Metric label="Срок выплаты" text={visible.deadline.date ? readableDate(visible.deadline.date) : 'Требует уточнения'} />
          <Metric label="Дни задержки" text={visible.deadline.delay_days === null ? 'Не определены' : String(visible.deadline.delay_days)} />
          <Metric label="Остаток выплаты" text={rubles(visible.remaining_amount)} />
        </View>
        <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 19 }}>Полнота данных: {{ sufficient: 'достаточная для этих проверок', limited: 'ограниченная', insufficient: 'недостаточная' }[visible.data_quality]}. {visible.data_quality_explanation}</Text>
      </Card> : dirty ? <Card><Text accessibilityLiveRegion="polite" style={{ color: theme.text, lineHeight: 23 }}>Уточнения изменены. Обновите анализ, чтобы увидеть результат для новых условий.</Text></Card>
        : error ? <Card><Text accessibilityLiveRegion="assertive" style={{ color: theme.danger, lineHeight: 23 }}>{error}</Text><Button secondary onPress={() => setAttempt(v => v + 1)}>Повторить анализ</Button></Card>
          : <View style={{ gap: 12, alignItems: 'center', padding: 24 }} accessibilityLiveRegion="polite"><ActivityIndicator color={theme.accent} /><Text style={{ color: theme.secondary }}>Проверяем сведения…</Text></View>}
      {!!visible?.missing.length && <Section title="Что уточнить"><Card>{visible.missing.map(text => <Bullet key={text} text={text} />)}</Card></Section>}
      <Card>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: refine }} onPress={() => setRefine(v => !v)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name="sliders" color={theme.accent} /><Text style={{ color: theme.text, fontSize: 16, fontWeight: '600', flex: 1 }}>Уточнить срок и расчёт</Text><Icon name={refine ? 'chevron-up' : 'chevron-down'} />
        </Pressable>
        {refine && <>
          <Text style={{ color: theme.secondary, fontSize: 13, lineHeight: 21 }}>Эти уточнения сохраняются отдельно. Даты, суммы и ответы анкеты можно исправить в чате; после изменения анкеты уточнения нужно проверить заново.</Text>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Выходные и праздники</Text>
          <Choice selected={draft.deadline_mode === 'unverified'} label="Срок с учётом графика пока не проверен" onPress={() => set({ deadline_mode: 'unverified' })} />
          <Choice selected={draft.deadline_mode === 'already_adjusted'} label="Подтверждаю: срок в анкете уже учитывает мой график, выходные и праздники" onPress={() => set({ deadline_mode: 'already_adjusted' })} />
          {value.answers.payment_type === 'salary' && <Choice selected={draft.deadline_mode === 'federal_five_day'} label="Дата в анкете — исходная. Перенести по федеральной пятидневке с выходными в субботу и воскресенье, без региональных праздников и особого графика" onPress={() => set({ deadline_mode: 'federal_five_day' })} />}
          {value.answers.payment_type === 'settlement' && <Choice selected={draft.deadline_mode === 'federal_five_day'} label="Применяется федеральная пятидневка с выходными в субботу и воскресенье, без региональных праздников и особого графика. Проверить следующий день после требования без переноса назад" onPress={() => set({ deadline_mode: 'federal_five_day' })} />}
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', marginTop: 6 }}>Основание суммы для компенсации</Text>
          <Choice selected={draft.amount_basis === 'unknown'} label="Начисление не подтверждено / есть спор о сумме" onPress={() => set({ amount_basis: 'unknown' })} />
          <Choice selected={draft.amount_basis === 'accrued'} label="Подтверждаю: указанная сумма начислена работодателем, это сумма к получению после удержаний" onPress={() => set({ amount_basis: 'accrued' })} />
          {['partial', 'full'].includes(value.answers.payment_status ?? '') && <>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', marginTop: 6 }}>Все поступления по этой выплате</Text>
            <Text style={{ color: theme.secondary, fontSize: 13, lineHeight: 20 }}>Нужна каждая дата и сумма, включая части, полученные до срока. Сумма истории должна совпасть с полем «Получено», последняя дата — с анкетой.</Text>
            {draft.payments.map((payment, index) => <View key={index} style={{ gap: 8, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ color: theme.secondary, flex: 1, fontSize: 12 }}>Выплата {index + 1}</Text><IconButton name="x" label={`Убрать выплату ${index + 1}`} onPress={() => set({ payments: draft.payments.filter((_, i) => i !== index) })} /></View>
              <Input label={`Дата выплаты ${index + 1}, ГГГГ-ММ-ДД`} placeholder="2026-11-10" value={payment.date} onChange={date => set({ payments: draft.payments.map((p, i) => i === index ? { ...p, date } : p) })} />
              <Input label={`Сумма выплаты ${index + 1} в рублях`} placeholder="Сумма в рублях" value={payment.amount} decimal onChange={amount => set({ payments: draft.payments.map((p, i) => i === index ? { ...p, amount } : p) })} />
            </View>)}
            <Button secondary disabled={draft.payments.length >= 50} onPress={() => set({ payments: [...draft.payments, { date: '', amount: '' }] })}>Добавить выплату</Button>
            <Choice checkbox selected={draft.payment_history_complete} label="Подтверждаю: указаны все поступления по этой сумме" onPress={() => set({ payment_history_complete: !draft.payment_history_complete })} />
          </>}
          {!!inputError && <Text accessibilityLiveRegion="assertive" style={{ color: theme.danger, lineHeight: 21 }}>{inputError}</Text>}
          <Button onPress={submit}>Обновить анализ</Button>
        </>}
      </Card>
      {visible && <>
        <Section title="Почему получился такой результат">{visible.findings.map(f => <Card key={f.id}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Icon name={f.status === 'supports' ? 'check-circle' : f.status === 'attention' ? 'alert-circle' : f.status === 'missing' ? 'help-circle' : 'info'} color={theme.accent} size={18} /><Text style={{ color: theme.text, fontSize: 16, lineHeight: 23, fontWeight: '600', flex: 1 }}>{f.title}</Text></View>
          <Text style={{ color: theme.text, fontSize: 14, lineHeight: 23 }}>{f.explanation}</Text>
          {!!f.facts.length && <View style={{ gap: 5 }}>{f.facts.map((fact, i) => <Text key={i} style={{ color: theme.secondary, fontSize: 12, lineHeight: 20 }}>{fact.label}: {fact.value}</Text>)}</View>}
          {citations(f.source_ids)}
        </Card>)}</Section>
        <Section title="Компенсация за задержку"><Card>
          <Text style={{ color: theme.text, fontSize: 25, fontWeight: '600' }}>{visible.compensation.status === 'unavailable' ? 'Пока не рассчитана' : rubles(visible.compensation.amount)}</Text>
          <Text style={{ color: theme.text, fontSize: 14, lineHeight: 23 }}>{visible.compensation.explanation}</Text>
          <Text style={{ color: theme.secondary, fontSize: 13, lineHeight: 21 }}>{visible.compensation.formula}</Text>
          {visible.compensation.missing.map(text => <Bullet key={text} text={text} />)}
          {citations(['tk-236'])}
          {!!visible.compensation.segments.length && <>
            <Button secondary onPress={() => setPeriods(v => !v)}>{periods ? 'Свернуть расчёт' : 'Показать расчёт по периодам'}</Button>
            {periods && visible.compensation.segments.map((s, index) => <View key={index} style={{ borderTopWidth: 1, borderColor: theme.border, paddingTop: 12, gap: 5 }}>
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>{readableDate(s.start)} — {readableDate(s.end)}</Text>
              <Text style={{ color: theme.secondary, fontSize: 13, lineHeight: 21 }}>{s.days} дн. · долг {rubles(s.principal)} · ставка {s.rate_percent}%</Text>
              <Text style={{ color: theme.text, fontSize: 14 }}>{rubles(s.amount)}</Text>
            </View>)}
          </>}
          <Pressable accessibilityRole="link" onPress={() => { setLinkError(''); void Linking.openURL(visible.compensation.rate_source_url).catch(() => setLinkError('Не удалось открыть сайт Банка России.')); }} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: theme.accent, fontSize: 12, lineHeight: 19 }}>Ставки Банка России · данные по {readableDate(visible.compensation.rates_checked_through)}</Text>
          </Pressable>
          {!!linkError && <Text accessibilityLiveRegion="polite" style={{ color: theme.danger, fontSize: 12 }}>{linkError}</Text>}
        </Card></Section>
        {!!visible.next_steps.length && <Section title="Что делать дальше"><Items values={visible.next_steps} citations={citations} /></Section>}
        {!!visible.documents.length && <Section title="Какие документы собрать"><Items values={visible.documents} citations={citations} /></Section>}
        <Section title="Когда обратиться к юристу"><Card>{visible.lawyer_reasons.length ? visible.lawyer_reasons.map(text => <Bullet key={text} text={text} />)
          : <Text style={{ color: theme.text, fontSize: 14, lineHeight: 23 }}>Если работодатель оспаривает факты или сумму, вы готовите обращение в суд либо сомневаетесь в сроках и применимости норм.</Text>}</Card></Section>
        {!!visible.sources.length && <Section title="Нормы ТК РФ">{visible.sources.map(s => <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`Прочитать ${s.citation}`} onPress={() => setSource(s)}
          style={({ pressed }) => ({ borderWidth: 1, borderColor: theme.border, backgroundColor: pressed ? theme.accentSoft : theme.surface, borderRadius: 15, padding: 16, gap: 6 })}>
          <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '600' }}>{s.citation}</Text><Text style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>{s.title}</Text>
        </Pressable>)}</Section>}
        <Section title="Ограничения оценки"><Card>{visible.limitations.map(text => <Bullet key={text} text={text} />)}<Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 19 }}>Поддерживаемый период: {readableDate(visible.rules.valid_from)} — {readableDate(visible.rules.checked_through)}. Для других дат нужна проверка редакций.</Text></Card></Section>
        <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 20 }}>{visible.disclaimer}</Text>
        {value.answers.jurisdiction === 'russia' && value.answers.employment_type === 'employment' && <Button onPress={() => router.push({ pathname: '/documents', params: { conversationId: chat.id } })}>Сформировать обращение</Button>}
      </>}
      <Button secondary onPress={back}>Вернуться к сведениям</Button>
    </ScrollView>
    {source && <SourceViewer source={source} onClose={() => setSource(null)} />}
  </>;
}

function Card({ children, accent = false }: PropsWithChildren<{ accent?: boolean }>) {
  const theme = useTheme();
  return <View style={{ padding: 18, gap: 13, borderRadius: 18, borderWidth: 1, borderColor: theme.border, backgroundColor: accent ? theme.accentSoft : theme.surface }}>{children}</View>;
}
function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  const theme = useTheme();
  return <View style={{ gap: 11 }}><Text accessibilityRole="header" style={{ color: theme.text, fontSize: 19, fontWeight: '600', marginTop: 6 }}>{title}</Text>{children}</View>;
}
function Metric({ label, text }: { label: string; text: string }) {
  const theme = useTheme();
  return <View style={{ minWidth: 125, flexGrow: 1, gap: 5 }}><Text style={{ color: theme.secondary, fontSize: 12 }}>{label}</Text><Text style={{ color: theme.text, fontSize: 17, fontWeight: '600' }}>{text}</Text></View>;
}
function Bullet({ text }: { text: string }) {
  const theme = useTheme();
  return <View style={{ flexDirection: 'row', gap: 9 }}><Text style={{ color: theme.accent }}>•</Text><Text style={{ color: theme.text, fontSize: 14, lineHeight: 23, flex: 1 }}>{text}</Text></View>;
}
function Choice({ label, selected, onPress, checkbox = false }: { label: string; selected: boolean; onPress: () => void; checkbox?: boolean }) {
  const theme = useTheme();
  return <Pressable accessibilityRole={checkbox ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected }} onPress={onPress}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 12, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: selected ? theme.accent : theme.border, backgroundColor: selected || pressed ? theme.accentSoft : theme.surface })}>
    <Icon name={selected ? 'check-circle' : 'circle'} size={20} color={selected ? theme.accent : theme.secondary} /><Text style={{ flex: 1, color: theme.text, fontSize: 13, lineHeight: 21 }}>{label}</Text>
  </Pressable>;
}
function Input({ label, placeholder, value, onChange, decimal = false }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; decimal?: boolean }) {
  const theme = useTheme();
  return <View style={{ gap: 6 }}><Text style={{ color: theme.secondary, fontSize: 12 }}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange}
    placeholder={placeholder} placeholderTextColor={theme.muted} keyboardType={decimal ? 'decimal-pad' : 'default'} maxLength={decimal ? 16 : 10}
    style={{ minHeight: 48, borderWidth: 1, borderColor: theme.border, borderRadius: 10, color: theme.text, backgroundColor: theme.background, paddingHorizontal: 12, fontSize: 15 }} /></View>;
}
function Items({ values, citations }: { values: AnalysisItem[]; citations: (ids: string[]) => ReactNode }) {
  const theme = useTheme();
  return <>{values.map(item => <Card key={item.id}><Text style={{ color: theme.text, fontSize: 15, fontWeight: '600', lineHeight: 23 }}>{item.title}</Text>
    <Text style={{ color: theme.text, fontSize: 14, lineHeight: 23 }}>{item.text}</Text>{citations(item.source_ids)}</Card>)}</>;
}

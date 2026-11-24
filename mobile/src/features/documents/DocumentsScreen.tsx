import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { caseFingerprint } from '@/domain/analysis';
import { emptyLetterDetails, hasDocumentPlaceholders, MAX_DOCUMENTS, MAX_DOCUMENT_TEXT, templateLabel, type DocumentDraft, type LetterDetails, type LetterTemplate } from '@/domain/documents';
import { type Conversation } from '@/domain/chat';
import { type LegalSource } from '@/domain/salary';
import { SourceViewer } from '@/features/knowledge/SourceViewer';
import { createLetterDraft, exportLetter } from '@/services/documents';
import { chatStore, useChatState } from '@/state/chatStore';
import { Button, ConfirmButton, Icon, IconButton } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';

const back = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };

export function DocumentsScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId?: string }>();
  const { data, storageError } = useChatState();
  const theme = useTheme();
  const chat = data.conversations.find(c => c.id === conversationId);
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: 800, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
          <IconButton name="arrow-left" label="Назад к кейсу" onPress={back} />
          <View style={{ flex: 1, gap: 3 }}><Text accessibilityRole="header" style={{ color: theme.text, fontSize: 21, fontWeight: '600' }}>Обращения</Text>
            <Text numberOfLines={1} style={{ color: theme.secondary, fontSize: 12 }}>{chat?.title ?? 'Кейс не найден'}</Text></View>
        </View>
        {chat ? <DocumentsContent key={chat.id} chat={chat} storageError={storageError} /> : <View style={{ padding: 24, gap: 16 }}>
          <Text style={{ color: theme.text, lineHeight: 23 }}>Этот чат не найден на устройстве.</Text><Button secondary onPress={back}>Вернуться к чату</Button>
        </View>}
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function DocumentsContent({ chat, storageError }: { chat: Conversation; storageError: string | null }) {
  const theme = useTheme();
  const drafts = chat.documentDrafts ?? [];
  const value = chat.salaryCase;
  const fingerprint = value ? caseFingerprint(value) : '';
  const canCreate = !!value?.confirmed && value.status === 'complete' && value.answers.jurisdiction === 'russia'
    && value.answers.employment_type === 'employment' && !chat.aiCandidates?.length
    && chat.messages.at(-1)?.status !== 'pending' && chat.messages.at(-1)?.status !== 'failed';
  const [selectedId, setSelectedId] = useState<string | null>(drafts.at(-1)?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState<LetterTemplate>('employer');
  const [details, setDetails] = useState<LetterDetails>(drafts.at(-1)?.details ?? emptyLetterDetails());
  const [busy, setBusy] = useState<'draft' | 'pdf' | 'docx' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [source, setSource] = useState<LegalSource | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef<string | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    if (generation.current && generation.current !== fingerprint) controller.current?.abort();
  }, [fingerprint]);
  const current = drafts.find(d => d.id === selectedId) ?? drafts.at(-1);
  const showForm = creating || !current;
  const stale = !current || current.caseFingerprint !== fingerprint || !canCreate;
  const placeholders = current ? [...new Set(current.text.match(/\[Укажите[^\]\n]*\]/gi) ?? [])] : [];
  const exportReady = !!current && !stale && current.reviewed && !placeholders.length && current.text.trim().length >= 80 && !busy;
  const change = (key: keyof LetterDetails, text: string) => setDetails(v => ({ ...v, [key]: text }));
  const start = (copy?: DocumentDraft) => {
    setError(''); setNotice(''); setCreating(true);
    if (copy) { setDetails({ ...copy.details }); setTemplate(copy.template); }
  };
  const generate = async () => {
    if (!value || !canCreate || busy || controller.current || drafts.length >= MAX_DOCUMENTS) return;
    const day = details.document_date;
    const parsed = new Date(`${day}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day
      || Number(day.slice(0, 4)) < 1900 || Number(day.slice(0, 4)) > 2100) {
      setError('Введите существующую дату обращения в формате ГГГГ-ММ-ДД, например 2026-11-23.'); return;
    }
    const active = new AbortController(); controller.current = active; generation.current = fingerprint;
    setBusy('draft'); setError(''); setNotice('');
    try {
      const id = randomUUID();
      const options = chat.salaryAnalysis?.caseFingerprint === fingerprint ? chat.salaryAnalysis.options : undefined;
      const result = await createLetterDraft(chat.id, id, template, value, details, options, active.signal);
      if (active.signal.aborted) return;
      const draft: DocumentDraft = { id, template, templateVersion: result.template_version, title: result.title, text: result.text,
        details: { ...details }, caseFingerprint: fingerprint, createdAt: result.created_at, updatedAt: result.created_at,
        reviewed: false, warnings: result.warnings, sources: result.sources };
      await chatStore.addDocumentDraft(chat.id, draft);
      if (active.signal.aborted) return;
      const retained = chatStore.getSnapshot().data.conversations.find(c => c.id === chat.id)?.documentDrafts?.some(d => d.id === id);
      if (!retained) throw new Error('Кейс изменился или удалён. Проверьте сведения и создайте черновик заново.');
      setSelectedId(id); setCreating(false);
    } catch (e) { if (!active.signal.aborted) setError(e instanceof Error ? e.message : 'Не удалось создать черновик.'); }
    finally { if (controller.current === active) { controller.current = null; generation.current = null; setBusy(null); } }
  };
  const download = async (format: 'pdf' | 'docx') => {
    if (!current || !exportReady || controller.current) return;
    const active = new AbortController(); controller.current = active; generation.current = fingerprint;
    setBusy(format); setError(''); setNotice('');
    try {
      await exportLetter(current, format, active.signal);
      if (!active.signal.aborted) setNotice(Platform.OS === 'web' ? 'Файл передан браузеру для сохранения. Проверьте папку загрузок.' : 'Открыто системное меню. Для сохранения выберите подходящее приложение или папку.');
    } catch (e) { if (!active.signal.aborted) setError(e instanceof Error ? e.message : 'Не удалось экспортировать документ.'); }
    finally { if (controller.current === active) { controller.current = null; generation.current = null; setBusy(null); } }
  };
  return <>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, minHeight: 0 }} indicatorStyle={theme.dark ? 'white' : 'black'} contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 36, gap: 17 }}>
      <Text style={{ color: theme.secondary, fontSize: 13, lineHeight: 21 }}>Черновики сохраняются в этом чате на устройстве. Вы сами проверяете, подписываете и подаёте обращение. AI для подготовки не нужен.</Text>
      {storageError && <Box><Text accessibilityLiveRegion="assertive" style={{ color: theme.danger, lineHeight: 22 }}>{storageError}</Text><Button secondary onPress={() => void chatStore.retrySave()}>Повторить сохранение</Button></Box>}
      {!!error && <Text accessibilityLiveRegion="assertive" style={{ color: theme.danger, lineHeight: 23 }}>{error}</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: theme.accent, lineHeight: 22 }}>{notice}</Text>}
      {!!drafts.length && <Box>
        <Heading text={`Сохранённые черновики (${drafts.length}/${MAX_DOCUMENTS})`} />
        {drafts.map(d => <Pressable key={d.id} disabled={!!busy} accessibilityRole="button" accessibilityState={{ selected: !showForm && current?.id === d.id }}
          onPress={() => { setSelectedId(d.id); setCreating(false); setError(''); setNotice(''); }} style={({ pressed }) => ({ padding: 12, minHeight: 54, borderRadius: 12, borderWidth: 1,
            borderColor: current?.id === d.id && !showForm ? theme.accent : theme.border, backgroundColor: pressed ? theme.accentSoft : theme.surface, gap: 5 })}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>{templateLabel(d.template)}</Text>
          <Text style={{ color: theme.secondary, fontSize: 12 }}>{new Date(d.updatedAt).toLocaleString('ru-RU')} · {d.reviewed ? 'проверен' : 'требует проверки'}</Text>
        </Pressable>)}
        <Button secondary disabled={!!busy || !canCreate || drafts.length >= MAX_DOCUMENTS} onPress={() => start()}>Новое обращение</Button>
        {drafts.length >= MAX_DOCUMENTS && <Text style={{ color: theme.secondary, lineHeight: 20 }}>Чтобы создать новый черновик, удалите ненужный из этого чата.</Text>}
      </Box>}
      {!canCreate && <Box><Text style={{ color: theme.text, lineHeight: 23 }}>Для нового обращения и экспорта завершите текущий запрос и подтвердите в анкете трудовой договор и работу в России. Старые черновики остаются доступными для просмотра.</Text><Button secondary onPress={back}>Вернуться к сведениям</Button></Box>}
      {showForm && canCreate ? <Box>
        <Heading text="Подготовить обращение" />
        <Select label="Работодателю" selected={template === 'employer'} disabled={!!busy} onPress={() => setTemplate('employer')} />
        <Select label="В трудовую инспекцию" selected={template === 'labor_inspectorate'} disabled={!!busy} onPress={() => setTemplate('labor_inspectorate')} />
        <Text style={{ color: theme.secondary, fontSize: 13, lineHeight: 21 }}>Реквизиты вводятся вами. Пропущенные значения будут отмечены в черновике; заполнить их нужно до экспорта.</Text>
        <Field label="Дата обращения (ГГГГ-ММ-ДД)" value={details.document_date} max={10} disabled={!!busy} onChange={v => change('document_date', v)} />
        <Field label="ФИО заявителя" value={details.applicant_name} disabled={!!busy} onChange={v => change('applicant_name', v)} />
        <Field label="Почтовый адрес заявителя для ответа" value={details.applicant_address} multiline max={600} disabled={!!busy} onChange={v => change('applicant_address', v)} />
        <Field label="Телефон или email (необязательно)" value={details.applicant_contact} disabled={!!busy} onChange={v => change('applicant_contact', v)} />
        <Field label="Наименование работодателя" value={details.employer_name} disabled={!!busy} onChange={v => change('employer_name', v)} />
        <Field label="Адрес работодателя" value={details.employer_address} multiline max={600} disabled={!!busy} onChange={v => change('employer_address', v)} />
        {template === 'labor_inspectorate' && <Field label="Наименование территориальной инспекции труда" value={details.inspectorate_name} disabled={!!busy} onChange={v => change('inspectorate_name', v)} />}
        <Field label="Должность (необязательно)" value={details.job_title} disabled={!!busy} onChange={v => change('job_title', v)} />
        <Field label="Дополнительные обстоятельства (необязательно)" value={details.additional_facts} multiline max={2000} disabled={!!busy} onChange={v => change('additional_facts', v)} />
        <Field label="Перечень приложений (необязательно)" value={details.attachments} multiline max={2000} disabled={!!busy} onChange={v => change('attachments', v)} />
        <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 19 }}>Впишите только документы, которые приложите при подаче. Файлы здесь не загружаются.</Text>
        <Select checkbox label="Включить просьбу проверить основания для компенсации" selected={details.request_compensation} disabled={!!busy} onPress={() => setDetails(v => ({ ...v, request_compensation: !v.request_compensation }))} />
        <Button disabled={!!busy || drafts.length >= MAX_DOCUMENTS} onPress={() => void generate()}>Сформировать черновик</Button>
        {!!drafts.length && <Button secondary disabled={!!busy} onPress={() => setCreating(false)}>К сохранённому черновику</Button>}
      </Box> : !showForm && current ? <Box>
        <Heading text={current.title} />
        {stale && <Text style={{ color: theme.danger, lineHeight: 22 }}>Сведения кейса изменились или ещё не подтверждены. Этот черновик относится к предыдущим данным. Для экспорта создайте новый после проверки анкеты.</Text>}
        {current.warnings.map(text => <Text key={text} style={{ color: theme.secondary, fontSize: 12, lineHeight: 20 }}>{text}</Text>)}
        <Field label="Текст обращения" value={current.text} multiline max={MAX_DOCUMENT_TEXT} large disabled={!!busy}
          onChange={text => { setNotice(''); void chatStore.editDocumentDraft(chat.id, current.id, { text }); }} />
        <Text style={{ color: theme.secondary, fontSize: 12 }}>Правки сохраняются автоматически · {current.text.length}/{MAX_DOCUMENT_TEXT}</Text>
        {!!placeholders.length && <Text style={{ color: theme.danger, fontSize: 13, lineHeight: 21 }}>Перед экспортом заполните в тексте: {placeholders.join('; ')}.</Text>}
        {current.text.trim().length < 80 && <Text style={{ color: theme.danger, lineHeight: 21 }}>Для экспорта нужен текст не короче 80 символов.</Text>}
        <Select checkbox label="Я проверил(а) факты, реквизиты, требования и приложения в тексте" selected={current.reviewed} disabled={!!busy || stale}
          onPress={() => void chatStore.editDocumentDraft(chat.id, current.id, { reviewed: !current.reviewed })} />
        <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 20 }}>Любая правка текста снимает отметку проверки. Экспортируется именно отредактированный текст.</Text>
        <Button disabled={!exportReady} onPress={() => void download('pdf')}>{busy === 'pdf' ? 'Готовим PDF…' : 'Скачать PDF'}</Button>
        <Button secondary disabled={!exportReady} onPress={() => void download('docx')}>{busy === 'docx' ? 'Готовим DOCX…' : 'Скачать DOCX'}</Button>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>{current.sources.map(s => <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`Прочитать ${s.citation}`} onPress={() => setSource(s)} style={{ padding: 10, minHeight: 40, borderRadius: 10, backgroundColor: theme.accentSoft }}><Text style={{ color: theme.accent, fontSize: 12 }}>{s.citation}</Text></Pressable>)}</View>
        <Button secondary disabled={!!busy || !canCreate || drafts.length >= MAX_DOCUMENTS} onPress={() => start(current)}>Новый черновик с этими реквизитами</Button>
        <ConfirmButton label="Удалить этот черновик" title="Удалить черновик?" description="Текст этого черновика будет удалён с устройства. Уже скачанные файлы останутся." disabled={!!busy}
          action={() => { void chatStore.removeDocumentDraft(chat.id, current.id); setSelectedId(null); setError(''); setNotice(''); }} />
      </Box> : null}
      {!!busy && <View style={{ gap: 12, alignItems: 'center' }} accessibilityLiveRegion="polite"><ActivityIndicator color={theme.accent} /><Button secondary onPress={() => { controller.current?.abort(); setNotice('Операция остановлена. Можно повторить.'); }}>Остановить подготовку</Button></View>}
      <Button secondary onPress={back}>Вернуться к кейсу</Button>
    </ScrollView>
    {source && <SourceViewer source={source} onClose={() => setSource(null)} />}
  </>;
}

function Box({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <View style={{ padding: 18, gap: 13, borderRadius: 18, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>{children}</View>;
}
function Heading({ text }: { text: string }) {
  const theme = useTheme();
  return <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 18, lineHeight: 26, fontWeight: '600' }}>{text}</Text>;
}
function Field({ label, value, onChange, max = 300, multiline = false, large = false, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; max?: number; multiline?: boolean; large?: boolean; disabled?: boolean;
}) {
  const theme = useTheme();
  return <View style={{ gap: 7 }}><Text style={{ color: theme.secondary, fontSize: 12 }}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange}
    editable={!disabled} multiline={multiline} maxLength={max} textAlignVertical="top" autoCapitalize="sentences"
    style={{ minHeight: large ? 460 : multiline ? 85 : 48, borderWidth: 1, borderColor: theme.border, borderRadius: 12, color: theme.text,
      backgroundColor: theme.background, padding: 12, fontSize: 14, lineHeight: 22, opacity: disabled ? 0.6 : 1 }} /></View>;
}
function Select({ label, selected, onPress, checkbox = false, disabled = false }: { label: string; selected: boolean; onPress: () => void; checkbox?: boolean; disabled?: boolean }) {
  const theme = useTheme();
  return <Pressable accessibilityRole={checkbox ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    style={{ padding: 12, gap: 10, flexDirection: 'row', alignItems: 'flex-start', minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accentSoft : theme.surface, opacity: disabled ? 0.5 : 1 }}>
    <Icon name={selected ? 'check-circle' : 'circle'} color={selected ? theme.accent : theme.secondary} size={20} /><Text style={{ flex: 1, color: theme.text, lineHeight: 21, fontSize: 13 }}>{label}</Text>
  </Pressable>;
}

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import type { DrawerNavigationProp } from 'expo-router/drawer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { MAX_MESSAGE_LENGTH, type Message } from '@/domain/chat';
import { chatStore, useChatState } from '@/state/chatStore';
import { Button, Chrome, Icon, IconButton, LegalMark } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';
import type { SalaryAction } from '@/domain/salary';
import { answerLabel, QuestionForm } from '@/features/salary/QuestionForm';
import { SalarySummary } from '@/features/salary/SalarySummary';
import { MessageRow } from './MessageRow';
import { AICandidates } from './AICandidates';
import type { AIAction } from '@/domain/ai';
import { SyncStatus } from '@/features/account/AccountPanel';

const suggestions = [
  { title: 'Задерживают зарплату', description: 'Разобраться шаг за шагом', icon: 'credit-card' as const, prompt: 'Мне задерживают зарплату. Хочу разобраться, что делать.' },
  { title: 'Выплатили только часть', description: 'Уточнить суммы и сроки', icon: 'briefcase' as const, prompt: 'Мне выплатили только часть зарплаты. ' },
  { title: 'Расчёт при увольнении', description: 'Собрать сведения о выплате', icon: 'file-text' as const, prompt: 'Меня уволили, но окончательный расчёт ещё не выплатили. ' },
];

export function ChatScreen() {
  const { data, storageError } = useChatState();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const navigation = useNavigation<DrawerNavigationProp<{ index: undefined }>>();
  const input = useRef<TextInput>(null);
  const list = useRef<FlatList<Message>>(null);
  const nearBottom = useRef(true);
  const [showBottom, setShowBottom] = useState(false);
  const chat = data.conversations.find(c => c.id === data.activeId);
  const draft = chat?.draft ?? data.newDraft;
  const messages = chat?.messages ?? [];
  const last = messages.at(-1);
  const pending = last?.status === 'pending';
  const failed = last?.status === 'failed';
  const tooLong = draft.trim().length > MAX_MESSAGE_LENGTH;
  const top = insets.top + 68;
  const salary = chat?.salaryCase;
  const aiMode = chat?.assistantMode === 'ai';
  const guided = chat?.scenario === 'salary_delay' && !aiMode;
  const candidates = chat?.aiCandidates ?? [];
  const question = salary?.question;
  const aiAction = (action: AIAction, label: string) => {
    if (pending || failed) return;
    nearBottom.current = true; Keyboard.dismiss();
    void chatStore.sendAIAction(action, label);
  };
  const answer = (action: SalaryAction, label: string) => {
    if (pending || failed) return;
    nearBottom.current = true; Keyboard.dismiss();
    void Haptics.selectionAsync().catch(() => undefined);
    if (aiMode && action.kind === 'confirm') void chatStore.sendAIAction('confirm', label);
    else void chatStore.sendSalaryAction(action, label);
  };

  useEffect(() => { nearBottom.current = true; setShowBottom(false); }, [chat?.id]);
  const scrollToBottom = () => {
    nearBottom.current = true;
    list.current?.scrollToEnd({ animated: !theme.reduceMotion });
  };
  const send = () => {
    if (!draft.trim() || pending || failed || tooLong) return;
    nearBottom.current = true;
    void Haptics.selectionAsync().catch(() => undefined);
    void chatStore.send();
  };

  return <KeyboardAvoidingView style={[styles.screen, { backgroundColor: theme.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Chrome style={[styles.header, { paddingTop: insets.top, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}>
      <View style={styles.headerRow}>
        {width < 1000 ? <IconButton name="sidebar" label="Открыть историю чатов" onPress={() => {
          Keyboard.dismiss(); if (theme.reduceMotion) router.push('/history'); else navigation.openDrawer();
        }} /> : <View style={{ width: 44 }} />}
        <View style={styles.headerTitle}><Text accessibilityRole="header" style={[styles.brand, { color: theme.text }]}>LegalIntel</Text>
          <Text style={[styles.headerCaption, { color: theme.secondary }]} numberOfLines={1}>{chat?.title ?? 'Новый диалог'}</Text></View>
        <IconButton name="edit" label="Новый чат" onPress={() => { chatStore.select(null); input.current?.focus(); }} />
      </View>
    </Chrome>

    {messages.length === 0 ? <ScrollView style={styles.history} indicatorStyle={theme.dark ? 'white' : 'black'} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.welcomeScroll, { paddingTop: top + 24 }]}>
      <View style={styles.welcome}>
        <LegalMark size={54} />
        <Text style={[styles.welcomeTitle, { color: theme.text }]}>С чего начнём?</Text>
        <Text style={[styles.welcomeSubtitle, { color: theme.secondary }]}>Опишите ситуацию своими словами.</Text>
        <View style={styles.suggestions}>{suggestions.map(suggestion => <Pressable key={suggestion.title} accessibilityRole="button"
          accessibilityLabel={suggestion.title} accessibilityHint={suggestion.icon === 'credit-card' ? 'Начать диалог с AI' : 'Добавит пример вопроса в поле ввода'} onPress={() => {
            if (suggestion.icon === 'credit-card') void chatStore.startAI();
            else { chatStore.setDraft(suggestion.prompt); input.current?.focus(); }
          }}
          style={({ pressed }) => [styles.suggestion, { backgroundColor: pressed ? theme.accentSoft : theme.surface, borderColor: theme.border, transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
          <View style={[styles.suggestionIcon, { backgroundColor: theme.accentSoft }]}><Icon name={suggestion.icon} size={19} color={theme.accent} /></View>
          <View style={{ flex: 1, gap: 4 }}><Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{suggestion.title}</Text>
            <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 17 }}>{suggestion.description}</Text></View>
          <Icon name="arrow-up-left" size={17} color={theme.muted} />
        </Pressable>)}</View>
        <View style={{ width: '100%', gap: 8, marginTop: 18 }}>
          <Button secondary onPress={() => void chatStore.startSalaryCase()}>Разобрать без AI</Button>
          <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 18, textAlign: 'center' }}>Пошаговая анкета и анализ выплаты без подключения модели.</Text>
        </View>
      </View>
    </ScrollView> : <View style={styles.history}>
      <FlatList key={chat?.id} ref={list} data={messages} keyExtractor={message => message.id} keyboardShouldPersistTaps="handled"
        indicatorStyle={theme.dark ? 'white' : 'black'}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        contentContainerStyle={{ paddingTop: top + 14, paddingBottom: 20 }}
        onScroll={event => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
          nearBottom.current = distance < 100;
          setShowBottom(distance > 250);
        }} scrollEventThrottle={100}
        onContentSizeChange={() => { if (nearBottom.current) list.current?.scrollToEnd({ animated: false }); }}
        renderItem={({ item, index }) => <MessageRow message={item} isLast={index === messages.length - 1}
          onRetry={() => { if (chat) void chatStore.retry(chat.id); }} onEdit={() => { if (chat) { chatStore.editFailed(chat.id); input.current?.focus(); } }} />}
        ListFooterComponent={<>
          {pending && <View style={styles.waiting} accessibilityLiveRegion="polite"><LegalMark size={27} />
            <ActivityIndicator size="small" color={theme.accent} /><Text style={{ color: theme.secondary, fontSize: 14 }}>Ожидаю ответ…</Text></View>}
          {aiMode && <AICandidates values={candidates} disabled={!!pending || !!failed} onAction={aiAction} />}
          {salary && <SalarySummary key={chat?.id} value={salary} disabled={!!pending || !!failed || !!candidates.length} onAction={answer}
            onAnalyze={() => { if (chat) router.push({ pathname: '/analysis', params: { conversationId: chat.id } }); }}
            onDocuments={chat?.documentDrafts?.length || (salary.confirmed && salary.answers.jurisdiction === 'russia' && salary.answers.employment_type === 'employment')
              ? () => { if (chat) router.push({ pathname: '/documents', params: { conversationId: chat.id } }); } : undefined} />}
        </>}
      />
      {showBottom && <View style={styles.bottomArrow}><IconButton name="arrow-down" label="К последнему сообщению" onPress={scrollToBottom}
        style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }} /></View>}
    </View>}

    <View style={[styles.composerArea, { paddingBottom: Math.max(insets.bottom, 12), paddingLeft: Math.max(insets.left, 14), paddingRight: Math.max(insets.right, 14) }]}>
      <View style={styles.composerWidth}>
        <SyncStatus />
        {storageError && <View style={[styles.storageWarning, { backgroundColor: theme.dangerSoft }]} accessibilityLiveRegion="assertive">
          <Text style={{ color: theme.danger, fontSize: 13, lineHeight: 19 }}>{storageError}</Text>
          <Pressable accessibilityRole="button" onPress={() => void chatStore.retrySave()} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: theme.danger, fontWeight: '600' }}>Повторить сохранение</Text></Pressable></View>}
        {guided ? <View style={{ gap: 8 }}>
          {question && <ScrollView style={{ maxHeight: Math.max(170, Math.min(320, height * 0.4)) }} keyboardShouldPersistTaps="handled"
            indicatorStyle={theme.dark ? 'white' : 'black'} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
            <Text accessibilityLiveRegion="polite" style={{ color: theme.secondary, fontSize: 12 }}>{question.label} · заполнено {salary?.progress.answered} из {salary?.progress.total}</Text>
            <QuestionForm key={question.field} question={question} value={draft} onChange={chatStore.setDraft} disabled={!!pending || !!failed}
              onAnswer={value => answer({ kind: 'answer', field: question.field, value }, answerLabel(question, value))} />
          </ScrollView>}
          {pending && <Button secondary onPress={() => { if (chat) chatStore.cancel(chat.id); }}>Остановить отправку</Button>}
          {!question && !pending && !failed && <Button secondary onPress={() => chatStore.select(null)}>Новый диалог</Button>}
          {!pending && !failed && chat && <Button secondary onPress={() => { chatStore.continueWithAI(chat.id); input.current?.focus(); }}>Продолжить диалог</Button>}
        </View> : <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: tooLong ? theme.danger : theme.border }]}>
          <TextInput ref={input} accessibilityLabel="Сообщение LegalIntel" placeholder={failed ? 'Сначала повторите или измените сообщение' : 'Сообщение LegalIntel'}
            placeholderTextColor={theme.muted} value={draft} onChangeText={chatStore.setDraft} multiline scrollEnabled
            style={[styles.input, { color: theme.text }]} editable={!failed} textAlignVertical="top" autoCapitalize="sentences"
            onKeyPress={event => {
              const key = event.nativeEvent as typeof event.nativeEvent & { shiftKey?: boolean; isComposing?: boolean };
              if (Platform.OS === 'web' && key.key === 'Enter' && !key.shiftKey && !key.isComposing) { event.preventDefault(); send(); }
            }} />
          <IconButton name={pending ? 'square' : 'arrow-up'} label={pending ? 'Остановить отправку' : 'Отправить сообщение'} accent
            disabled={!pending && (!draft.trim() || !!failed || tooLong)}
            onPress={() => { if (pending && chat) chatStore.cancel(chat.id); else send(); }} style={{ margin: 6, borderRadius: 14 }} />
        </View>}
        {!guided && draft.length >= 3500 && <Text style={{ textAlign: 'right', fontSize: 12, color: tooLong ? theme.danger : theme.muted, marginTop: 5 }}>{draft.trim().length} / {MAX_MESSAGE_LENGTH}</Text>}
        {aiMode && <Text style={[styles.footer, { color: theme.muted }]}>AI может ошибаться. Проверяйте сведения и источники.</Text>}
      </View>
    </View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, history: { flex: 1, minHeight: 0 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  headerRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  headerTitle: { flex: 1, gap: 3, alignItems: 'center' },
  brand: { fontSize: 20, fontWeight: '600', letterSpacing: -0.6 },
  headerCaption: { fontSize: 11, letterSpacing: 0.2, maxWidth: '100%' },
  welcomeScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 28 },
  welcome: { width: '100%', maxWidth: 380, alignSelf: 'center', alignItems: 'center' },
  welcomeTitle: { fontSize: 29, fontWeight: '600', letterSpacing: -0.9, marginTop: 22, textAlign: 'center' },
  welcomeSubtitle: { fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 10 },
  suggestions: { width: '100%', gap: 10, marginTop: 33 },
  suggestion: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 14, minHeight: 75, gap: 12, flexDirection: 'row', alignItems: 'center' },
  suggestionIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  waiting: { maxWidth: 760, width: '100%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 11, padding: 22 },
  bottomArrow: { position: 'absolute', bottom: 12, alignSelf: 'center' },
  composerArea: { paddingTop: 8 }, composerWidth: { width: '100%', maxWidth: 730, alignSelf: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderRadius: 23, overflow: 'hidden' },
  input: { flex: 1, fontSize: 16, lineHeight: 24, paddingTop: 16, paddingBottom: 15, paddingLeft: 18, paddingRight: 6, maxHeight: 148, minHeight: 56 },
  footer: { fontSize: 10, lineHeight: 15, textAlign: 'center', paddingHorizontal: 7, marginTop: 9 },
  storageWarning: { borderRadius: 14, padding: 12, marginBottom: 10 },
});

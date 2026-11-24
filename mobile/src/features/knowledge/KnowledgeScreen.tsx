import { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { readableDate, type CorpusStatus, type LegalSource, type SourceExcerpt } from '@/domain/salary';
import { getKnowledge } from '@/services/api';
import { Button, IconButton } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';
import { SourceViewer } from './SourceViewer';

export function KnowledgeScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ corpus: CorpusStatus; documents: (LegalSource | SourceExcerpt)[] } | null>(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState<LegalSource | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setData(null);
    getKnowledge(search, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Не удалось открыть базу.'); });
    return () => controller.abort();
  }, [search, attempt]);
  const submit = () => { Keyboard.dismiss(); setSearch(query.trim()); setAttempt(v => v + 1); };
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <View style={{ width: '100%', maxWidth: 780, flex: 1, minHeight: 0, alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 }}>
        <IconButton name="arrow-left" label="Назад к чату" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/'); }} />
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 22, fontWeight: '600' }}>Правовая база</Text>
      </View>
      <View style={{ paddingHorizontal: 20, gap: 12, paddingBottom: 16 }}>
        <Text style={{ color: theme.secondary, fontSize: 14, lineHeight: 21 }}>Нормы о выплатах и трудовых отношениях. Ищите по теме или номеру статьи.</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 16, paddingLeft: 14 }}>
          <TextInput accessibilityLabel="Поиск по правовой базе" value={query} onChangeText={setQuery} placeholder="Например: компенсация или 236"
            placeholderTextColor={theme.muted} returnKeyType="search" maxLength={300} onSubmitEditing={submit} style={{ minHeight: 52, fontSize: 15, color: theme.text, flex: 1 }} />
          {!!query && <IconButton name="x" label="Очистить поиск" onPress={() => { setQuery(''); setSearch(''); }} />}
          <IconButton name="search" label="Найти нормы" onPress={submit} />
        </View>
      </View>
      <ScrollView style={{ flex: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" indicatorStyle={theme.dark ? 'white' : 'black'} contentContainerStyle={{ padding: 20, paddingTop: 0, gap: 12 }}>
        {data ? <>
          <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 19 }}>{data.corpus.documents} статей · проверено {readableDate(data.corpus.checked_on)}{search ? `\nРезультаты для «${search}»` : ''}</Text>
          {data.documents.length === 0 && <Text style={{ color: theme.secondary, paddingVertical: 24, lineHeight: 23 }}>Ничего не найдено. Попробуйте другое слово или номер статьи.</Text>}
          {data.documents.map(item => <Pressable key={'chunk_id' in item ? item.chunk_id : item.id} accessibilityRole="button"
            accessibilityLabel={`Прочитать ${item.citation}`} onPress={() => setSource(item)} style={({ pressed }) => ({
              backgroundColor: pressed ? theme.accentSoft : theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 18, padding: 17, gap: 8,
            })}>
            <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '600' }}>{item.citation}</Text>
            <Text style={{ color: theme.text, fontSize: 16, lineHeight: 24 }}>{item.title}</Text>
            {'excerpt' in item && <Text numberOfLines={4} style={{ color: theme.secondary, fontSize: 13, lineHeight: 21 }}>{item.excerpt}</Text>}
            <Text style={{ color: theme.muted, fontSize: 12 }}>{item.edition}</Text>
          </Pressable>)}
          <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 19, paddingVertical: 12 }}>База содержит тексты нормативных актов. Поиск не определяет применимость нормы к конкретному случаю. Для событий прошлых лет может потребоваться другая редакция.</Text>
        </> : error ? <View style={{ gap: 14 }}><Text style={{ color: theme.danger, lineHeight: 22 }}>{error}</Text><Button secondary onPress={() => setAttempt(v => v + 1)}>Повторить</Button></View>
          : <View style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.accent} accessibilityLabel="Загрузка правовой базы" />
            <Text style={{ color: theme.secondary, fontSize: 14 }}>Загрузка правовой базы…</Text>
          </View>}
      </ScrollView>
    </View>
    {source && <SourceViewer source={source} onClose={() => setSource(null)} />}
  </SafeAreaView>;
}

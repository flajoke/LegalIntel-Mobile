import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { readableDate, type LegalDocument, type LegalSource } from '@/domain/salary';
import { getLegalDocument } from '@/services/api';
import { Button, Dialog } from '@/ui/Primitives';
import { useTheme } from '@/ui/theme';

export function SourceViewer({ source, onClose }: { source: LegalSource; onClose: () => void }) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const [document, setDocument] = useState<LegalDocument | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDocument(null); setError('');
    getLegalDocument(source.id, controller.signal).then(value => {
      if (!controller.signal.aborted) setDocument(value);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Не удалось загрузить источник.'); });
    return () => controller.abort();
  }, [source.id, attempt]);
  const shown = document ?? source;
  return <Dialog visible title={source.citation} onClose={onClose}>
    <ScrollView style={{ maxHeight: Math.max(160, height * 0.64), flexShrink: 1 }} keyboardShouldPersistTaps="handled"
      indicatorStyle={theme.dark ? 'white' : 'black'} contentContainerStyle={{ gap: 14, paddingBottom: 12 }}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 18, lineHeight: 26, fontWeight: '600' }}>{shown.title}</Text>
      <Text style={{ color: theme.secondary, fontSize: 12, lineHeight: 19 }}>{shown.edition}{'\n'}Проверено {readableDate(shown.checked_on)}{'\n'}{shown.publisher}</Text>
      {source.sha256 !== shown.sha256 && <Text style={{ color: theme.secondary, fontSize: 13 }}>Текст базы обновлён после сохранения диалога. Ниже показана новая версия источника.</Text>}
      {document ? <Text selectable style={{ color: theme.text, fontSize: 15, lineHeight: 25 }}>{document.text}</Text>
        : error ? <View style={{ gap: 10 }}><Text style={{ color: theme.danger }}>{error}</Text><Button secondary onPress={() => setAttempt(v => v + 1)}>Повторить</Button></View>
        : <ActivityIndicator color={theme.accent} accessibilityLabel="Загрузка текста статьи" />}
      <Button secondary onPress={() => { void Linking.openURL(shown.source_url).catch(() => setError('Не удалось открыть ссылку.')); }}>Открыть источник</Button>
      {!!document && !!error && <Text accessibilityLiveRegion="polite" style={{ color: theme.danger }}>{error}</Text>}
    </ScrollView>
  </Dialog>;
}

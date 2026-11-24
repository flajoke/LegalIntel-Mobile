import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyData, type StoredData } from '@/domain/chat';
import { isExcerpt, isSalaryAction, isSalaryCase, record } from '@/domain/salary';
import { isAIAction, isCandidate } from '@/domain/ai';
import { isSavedAnalysisOptions } from '@/domain/analysis';
import { isDocumentDraft, MAX_DOCUMENTS } from '@/domain/documents';

const KEY = '@legalintel/chats/v3';
const LEGACY_KEYS = ['@legalintel/chats/v2', '@legalintel/chats/v1'];
export interface ChatRepository {
  load(): Promise<StoredData>;
  save(data: StoredData): Promise<void>;
  reset(): Promise<void>;
}
const stringFields = (v: Record<string, unknown>, fields: string[]) => fields.every(k => typeof v[k] === 'string');
function validMessage(v: unknown): boolean {
  return record(v) && stringFields(v, ['id', 'content', 'createdAt'])
    && ['user', 'assistant'].includes(String(v.role)) && ['sent', 'pending', 'failed'].includes(String(v.status))
    && (v.error === undefined || typeof v.error === 'string') && (v.inReplyTo === undefined || typeof v.inReplyTo === 'string')
    && (v.mode === undefined || ['stub', 'guided', 'ai'].includes(String(v.mode)))
    && (v.scenarioAction === undefined || isSalaryAction(v.scenarioAction))
    && (v.aiAction === undefined || isAIAction(v.aiAction))
    && (v.sources === undefined || (Array.isArray(v.sources) && v.sources.every(isExcerpt)));
}
export function decodeChatData(raw: string): StoredData {
  const v: unknown = JSON.parse(raw);
  if (!record(v) || typeof v.version !== 'number' || ![1, 2, 3].includes(v.version)
    || !Array.isArray(v.conversations) || !v.conversations.every(c => record(c)
      && stringFields(c, ['id', 'title', 'createdAt', 'updatedAt', 'draft'])
      && Array.isArray(c.messages) && c.messages.every(validMessage)
      && (c.scenario === undefined || c.scenario === 'salary_delay')
      && (c.salaryCase === undefined || isSalaryCase(c.salaryCase))
      && (c.assistantMode === undefined || ['ai', 'guided'].includes(String(c.assistantMode)))
      && (c.aiCandidates === undefined || (Array.isArray(c.aiCandidates) && c.aiCandidates.every(isCandidate)))
      && (c.salaryAnalysis === undefined || isSavedAnalysisOptions(c.salaryAnalysis))
      && (c.documentDrafts === undefined || (Array.isArray(c.documentDrafts) && c.documentDrafts.length <= MAX_DOCUMENTS && c.documentDrafts.every(isDocumentDraft))))
    || (v.activeId !== null && typeof v.activeId !== 'string') || typeof v.newDraft !== 'string'
    || !record(v.settings) || typeof v.settings.apiUrl !== 'string'
    || !['system', 'light', 'dark'].includes(String(v.settings.theme))) {
    throw new Error('Неподдерживаемый или повреждённый формат истории');
  }
  return { ...v, version: 3 } as StoredData;
}
export const chatRepository: ChatRepository = {
  async load() {
    let raw = await AsyncStorage.getItem(KEY);
    if (raw !== null) return decodeChatData(raw);
    for (const oldKey of LEGACY_KEYS) {
      raw = await AsyncStorage.getItem(oldKey);
      if (raw === null) continue;
      const data = decodeChatData(raw);
      // Commit before removal: a failed migration never destroys the old history.
      await AsyncStorage.setItem(KEY, JSON.stringify(data));
      await AsyncStorage.multiRemove(LEGACY_KEYS);
      return data;
    }
    return emptyData();
  },
  save: data => AsyncStorage.setItem(KEY, JSON.stringify(data)),
  reset: () => AsyncStorage.multiRemove([KEY, ...LEGACY_KEYS]),
};

export function accountRepository(userId: string): ChatRepository {
  if (!/^[a-f0-9-]{36}$/i.test(userId)) throw new Error('Некорректный аккаунт');
  const key = `@legalintel/account/${userId}/chats/v3`;
  return {
    async load() { const raw = await AsyncStorage.getItem(key); return raw === null ? emptyData() : decodeChatData(raw); },
    save: data => AsyncStorage.setItem(key, JSON.stringify(data)),
    reset: () => AsyncStorage.removeItem(key),
  };
}

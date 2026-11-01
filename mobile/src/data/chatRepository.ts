import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyData, type Conversation, type Message, type StoredData } from '@/domain/chat';

const STORAGE_KEY = '@legalintel/chats/v1';
const LEGACY_STUB_REPLY = 'Сообщение получено. Сейчас я отвечаю в демонстрационном режиме.\n\n'
  + 'Разбор вашей ситуации, ссылки на нормы закона и рекомендации появятся в следующей версии LegalIntel.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function isMessage(value: unknown): value is Message {
  return isRecord(value) && typeof value.id === 'string' && typeof value.content === 'string'
    && ['user', 'assistant'].includes(String(value.role)) && validDate(value.createdAt)
    && ['pending', 'sent', 'failed'].includes(String(value.status))
    && (value.error === undefined || typeof value.error === 'string')
    && (value.inReplyTo === undefined || typeof value.inReplyTo === 'string')
    && (value.mode === undefined || value.mode === 'stub');
}
function isConversation(value: unknown): value is Conversation {
  return isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string'
    && typeof value.draft === 'string' && validDate(value.createdAt) && validDate(value.updatedAt)
    && Array.isArray(value.messages) && value.messages.every(isMessage);
}

export interface ChatRepository {
  load(): Promise<StoredData>;
  save(data: StoredData): Promise<void>;
  reset(): Promise<void>;
}

export const chatRepository: ChatRepository = {
  async load() {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyData();
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.conversations)
      || !data.conversations.every(isConversation) || typeof data.newDraft !== 'string'
      || !(data.activeId === null || typeof data.activeId === 'string')
      || !isRecord(data.settings) || typeof data.settings.apiUrl !== 'string'
      || !['system', 'light', 'dark'].includes(String(data.settings.theme))) {
      // Never silently overwrite corrupt data or a future schema version.
      throw new Error('Не удалось прочитать сохранённые чаты. Данные не изменены.');
    }
    const stored = data as StoredData;
    // Remove only the exact retired placeholder; user text and other replies stay intact.
    return { ...stored, conversations: stored.conversations.map(chat => ({ ...chat,
      messages: chat.messages.map(message => message.role === 'assistant' && message.mode === 'stub' && message.content === LEGACY_STUB_REPLY
        ? { ...message, content: LEGACY_STUB_REPLY.split('\n\n')[0]! } : message),
    })) };
  },
  async save(data) { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)); },
  async reset() { await AsyncStorage.removeItem(STORAGE_KEY); },
};

import { useSyncExternalStore } from 'react';
import { randomUUID } from 'expo-crypto';
import { chatRepository, type ChatRepository } from '@/data/chatRepository';
import { contextFor, emptyData, MAX_MESSAGE_LENGTH, type Conversation, type StoredData } from '@/domain/chat';
import { defaultApiUrl, sendChat } from '@/services/api';

type Snapshot = {
  data: StoredData;
  ready: boolean;
  loadError: string | null;
  storageError: string | null;
};

class ChatStore {
  private snapshot: Snapshot = { data: emptyData(), ready: false, loadError: null, storageError: null };
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private revision = 0;
  private loading?: Promise<void>;
  private inFlight = new Map<string, { messageId: string; controller: AbortController }>();

  constructor(private repository: ChatRepository) {}
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => this.listeners.delete(callback); };
  getSnapshot = () => this.snapshot;
  private emit(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private async commit(data: StoredData): Promise<boolean> {
    this.emit({ data });
    const revision = ++this.revision;
    // Serialize immutable snapshots, so a late write cannot restore old chats
    // after a rename/delete or overwrite a newer response.
    const write = this.writes.then(() => this.repository.save(data));
    this.writes = write.catch(() => undefined);
    try {
      await write;
      if (revision === this.revision) this.emit({ storageError: null });
      return true;
    } catch {
      this.emit({ storageError: 'Не удалось сохранить изменения на устройстве. Проверьте свободное место и повторите сохранение.' });
      return false;
    }
  }

  initialize = async () => {
    if (this.snapshot.ready) return;
    if (this.loading) return this.loading;
    this.emit({ loadError: null });
    this.loading = (async () => {
      try {
        const data = await this.repository.load();
        let interrupted = false;
        const conversations = data.conversations.map(chat => ({ ...chat, messages: chat.messages.map(message => {
          if (message.status !== 'pending') return message;
          interrupted = true;
          return { ...message, status: 'failed' as const, error: 'Приложение закрылось до получения ответа. Отправьте сообщение повторно.' };
        }) }));
        const restored = { ...data, conversations, activeId: conversations.some(c => c.id === data.activeId) ? data.activeId : null };
        this.emit({ data: restored, ready: true });
        if (interrupted) await this.commit(restored);
      } catch {
        this.emit({ loadError: 'Не удалось открыть сохранённые чаты. Ваши данные не изменены.' });
      }
    })();
    try { await this.loading; } finally { this.loading = undefined; }
  };

  retrySave = () => this.commit(this.snapshot.data);
  resetUnreadable = async () => {
    try { await this.repository.reset(); await this.initialize(); }
    catch { this.emit({ loadError: 'Не удалось очистить хранилище. Попробуйте снова.' }); }
  };

  select = (id: string | null) => {
    if (!this.snapshot.ready) return;
    if (id && !this.snapshot.data.conversations.some(chat => chat.id === id)) return;
    void this.commit({ ...this.snapshot.data, activeId: id });
  };
  setDraft = (draft: string) => {
    if (!this.snapshot.ready) return;
    const data = this.snapshot.data;
    void this.commit(data.activeId ? { ...data, conversations: data.conversations.map(chat =>
      chat.id === data.activeId ? { ...chat, draft } : chat) } : { ...data, newDraft: draft });
  };
  saveSettings = (settings: StoredData['settings']) => this.commit({ ...this.snapshot.data, settings });
  rename = (id: string, title: string) => this.commit({ ...this.snapshot.data,
    conversations: this.snapshot.data.conversations.map(chat => chat.id === id ? { ...chat, title: title.trim().slice(0, 80) || chat.title } : chat),
  });
  remove = async (id: string) => {
    this.inFlight.get(id)?.controller.abort();
    this.inFlight.delete(id);
    const data = this.snapshot.data;
    return this.commit({ ...data, activeId: data.activeId === id ? null : data.activeId,
      conversations: data.conversations.filter(chat => chat.id !== id) });
  };
  clearChats = async () => {
    this.inFlight.forEach(item => item.controller.abort());
    this.inFlight.clear();
    return this.commit({ ...emptyData(), settings: this.snapshot.data.settings });
  };
  cancel = (id: string) => { this.inFlight.get(id)?.controller.abort(); };

  editFailed = (id: string) => {
    const data = this.snapshot.data;
    const chat = data.conversations.find(c => c.id === id);
    const message = chat?.messages.at(-1);
    if (!chat || !message || message.status !== 'failed') return;
    void this.commit({ ...data, conversations: data.conversations.map(c => c.id !== id ? c :
      { ...c, draft: message.content, messages: c.messages.slice(0, -1) }) });
  };

  send = async () => {
    if (!this.snapshot.ready) return;
    const data = this.snapshot.data;
    const current = data.conversations.find(c => c.id === data.activeId);
    const content = (current?.draft ?? data.newDraft).trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH || (current && this.inFlight.has(current.id))) return;
    if (current?.messages.at(-1)?.status === 'failed') return;
    const time = new Date().toISOString();
    const chat: Conversation = current ?? {
      id: randomUUID(), title: content.replace(/\s+/g, ' ').slice(0, 48),
      createdAt: time, updatedAt: time, draft: '', messages: [],
    };
    const messageId = randomUUID();
    const controller = new AbortController();
    this.inFlight.set(chat.id, { messageId, controller });
    const nextChat = { ...chat, updatedAt: time, draft: '', messages: [...chat.messages, {
      id: messageId, role: 'user' as const, content, createdAt: time, status: 'pending' as const,
    }] };
    const saved = await this.commit({ ...data, activeId: chat.id, newDraft: current ? data.newDraft : '',
      conversations: current ? data.conversations.map(c => c.id === chat.id ? nextChat : c) : [nextChat, ...data.conversations],
    });
    await this.deliver(chat.id, messageId, controller, saved);
  };

  retry = async (id: string) => {
    const chat = this.snapshot.data.conversations.find(c => c.id === id);
    const message = chat?.messages.at(-1);
    if (!chat || !message || message.status !== 'failed' || this.inFlight.has(id)) return;
    const controller = new AbortController();
    this.inFlight.set(id, { messageId: message.id, controller });
    const saved = await this.updateChat(id, c => ({ ...c, messages: c.messages.map(m =>
      m.id === message.id ? { ...m, status: 'pending', error: undefined } : m) }));
    await this.deliver(id, message.id, controller, saved);
  };

  private updateChat(id: string, transform: (chat: Conversation) => Conversation): Promise<boolean> {
    const data = this.snapshot.data;
    if (!data.conversations.some(c => c.id === id)) return Promise.resolve(false);
    return this.commit({ ...data, conversations: data.conversations.map(c => c.id === id ? transform(c) : c) });
  }

  private async deliver(id: string, messageId: string, controller: AbortController, saved: boolean) {
    const isCurrent = () => this.inFlight.get(id)?.controller === controller;
    try {
      if (!isCurrent()) return;
      if (!saved) throw new Error('Сообщение не отправлено: сначала восстановите сохранение на устройстве.');
      const data = this.snapshot.data;
      const chat = data.conversations.find(c => c.id === id);
      const message = chat?.messages.find(m => m.id === messageId);
      if (!chat || !message) return;
      const result = await sendChat(defaultApiUrl(), {
        conversation_id: id, client_message_id: messageId, message: message.content,
        history: contextFor(chat.messages.slice(0, chat.messages.indexOf(message))),
      }, controller.signal);
      if (!isCurrent()) return;
      await this.updateChat(id, c => ({ ...c, updatedAt: new Date().toISOString(), messages: [
        ...c.messages.filter(m => m.inReplyTo !== messageId).map(m =>
          m.id === messageId ? { ...m, status: 'sent' as const, error: undefined } : m),
        { id: result.message.id, role: 'assistant', content: result.message.content,
          createdAt: result.message.created_at, status: 'sent', mode: result.mode, inReplyTo: messageId },
      ] }));
    } catch (error) {
      if (!isCurrent()) return;
      await this.updateChat(id, c => ({ ...c, messages: c.messages.map(m => m.id === messageId
        ? { ...m, status: 'failed', error: error instanceof Error ? error.message : 'Не удалось получить ответ.' } : m) }));
    } finally {
      if (isCurrent()) this.inFlight.delete(id);
    }
  }
}

export const chatStore = new ChatStore(chatRepository);
export const useChatState = () => useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getSnapshot);

import { randomUUID } from 'expo-crypto';
import type { StoredData, Conversation } from './chat';
import { record } from './salary';

export type AccountUser = { id: string; username: string; created_at: string };
export function isAccountUser(v: unknown): v is AccountUser {
  return record(v) && typeof v.id === 'string' && /^[0-9a-f-]{36}$/i.test(v.id)
    && typeof v.username === 'string' && typeof v.created_at === 'string';
}
export function stableState(value: unknown): string {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : record(v)
    ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, sorted(v[k])])) : v;
  return JSON.stringify(sorted(value));
}
export function mergeCopies(remote: StoredData, local: StoredData): StoredData {
  const conversations: Conversation[] = [...remote.conversations];
  const ids = new Map(conversations.map(c => [c.id, c]));
  for (const chat of local.conversations) {
    const existing = ids.get(chat.id);
    if (!existing) { conversations.push(chat); ids.set(chat.id, chat); }
    else if (stableState(existing) !== stableState(chat)) {
      conversations.push({ ...chat, id: randomUUID(), title: `${chat.title.slice(0, 60)} (локальная копия)` });
    }
  }
  if (local.newDraft && remote.newDraft && local.newDraft !== remote.newDraft) {
    const now = new Date().toISOString();
    conversations.push({ id: randomUUID(), title: 'Черновик с другого устройства', createdAt: now, updatedAt: now, draft: remote.newDraft, messages: [] });
  }
  // Preserve an unsent empty-chat draft as a local copy if both devices edited it.
  return { ...remote, conversations, newDraft: local.newDraft || remote.newDraft, activeId: local.activeId && conversations.some(c => c.id === local.activeId) ? local.activeId : remote.activeId,
    settings: local.settings };
}

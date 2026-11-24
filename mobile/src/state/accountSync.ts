import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { chatRepository, decodeChatData } from '@/data/chatRepository';
import { mergeCopies, stableState } from '@/domain/account';
import type { StoredData } from '@/domain/chat';
import { record } from '@/domain/salary';
import { AccountHTTPError, accountRequest } from '@/services/session';
import { chatStore } from './chatStore';

type Meta = { revision: number; fingerprint: string; imported?: string };
type SyncState = { status: 'local' | 'syncing' | 'saved' | 'offline' | 'conflict'; message: string; legacyCount: number; savedAt: string | null };
type Remote = { revision: number; state: StoredData | null; updated_at: string | null };
const hash = (state: StoredData) => digestStringAsync(CryptoDigestAlgorithm.SHA256, stableState(state));
const metaKey = (id: string) => `@legalintel/account/${id}/sync/v1`;
const LEGACY_OWNER = '@legalintel/legacy-owner/v1';

export class AccountSync {
  private state: SyncState = { status: 'local', message: 'История сохранена на устройстве.', legacyCount: 0, savedAt: null };
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private epoch = 0;
  private meta: Meta = { revision: 0, fingerprint: '' };
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private controller?: AbortController;
  private busy = false;
  private applying = false;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = () => this.state;
  private emit(patch: Partial<SyncState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  stop = () => {
    this.epoch++; this.userId = null; this.controller?.abort(); this.controller = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.unsubscribe?.(); this.unsubscribe = undefined; this.busy = false; this.applying = false;
  };
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (this.state.status !== 'conflict') this.timer = setTimeout(() => void this.refresh(), 2000);
  }
  private async remote(signal: AbortSignal): Promise<Remote> {
    const value = await accountRequest('account/state', undefined, signal);
    if (!record(value) || !Number.isInteger(value.revision) || Number(value.revision) < 0
      || !(value.updated_at === null || typeof value.updated_at === 'string')) throw new Error('Не удалось проверить серверную историю.');
    return { revision: Number(value.revision), state: value.state === null ? null : decodeChatData(JSON.stringify(value.state)), updated_at: value.updated_at as string | null };
  }
  private valid(epoch: number) { return this.epoch === epoch && this.userId === chatStore.getAccountId(); }
  start = async (userId: string) => {
    this.stop(); this.userId = userId;
    const epoch = this.epoch;
    this.meta = { revision: 0, fingerprint: '' };
    this.emit({ status: 'local', message: 'Подключаем историю аккаунта…', legacyCount: 0, savedAt: null });
    try {
      const raw = await AsyncStorage.getItem(metaKey(userId));
      if (!this.valid(epoch)) return;
      const value: unknown = raw ? JSON.parse(raw) : null;
      if (record(value) && Number.isInteger(value.revision) && Number(value.revision) >= 0 && typeof value.fingerprint === 'string') {
        this.meta = { revision: Number(value.revision), fingerprint: value.fingerprint, imported: typeof value.imported === 'string' ? value.imported : undefined };
      }
      const owner = await AsyncStorage.getItem(LEGACY_OWNER);
      if (!this.valid(epoch)) return;
      if (!owner || owner === userId) {
        const legacy = await chatRepository.load();
        if (!this.valid(epoch)) return;
        const legacyHash = await hash(legacy);
        if (!this.valid(epoch)) return;
        this.emit({ legacyCount: legacyHash === this.meta.imported ? 0 : legacy.conversations.length });
      }
    } catch { /* A failed optional import preview must not erase the old history. */ }
    if (!this.valid(epoch)) return;
    await this.refresh();
    if (!this.valid(epoch)) return;
    let observed = chatStore.getSnapshot().data;
    this.unsubscribe = chatStore.subscribe(() => {
      const current = chatStore.getSnapshot().data;
      if (observed === current) return;
      observed = current;
      if (this.applying || !this.valid(epoch)) return;
      if (this.state.status !== 'conflict') this.emit({ status: 'local', message: 'Изменения сохранены на устройстве; отправляем в аккаунт…' });
      this.schedule();
    });
  };
  refresh = async () => {
    const userId = this.userId, epoch = this.epoch;
    if (!userId || this.busy || !chatStore.getSnapshot().ready || chatStore.hasPending()) return;
    if (this.state.status === 'conflict') return;
    this.busy = true;
    const controller = new AbortController(); this.controller = controller;
    this.emit({ status: 'syncing', message: 'Синхронизация…' });
    try {
      const current = chatStore.getSnapshot().data;
      const fingerprint = await hash(current);
      if (!this.valid(epoch)) return;
      if (fingerprint !== this.meta.fingerprint && (current.conversations.length || current.newDraft || this.meta.fingerprint)) {
        await this.push(userId, epoch, current, fingerprint, controller.signal);
      } else {
        const remote = await this.remote(controller.signal);
        if (!this.valid(epoch)) return;
        if (await hash(chatStore.getSnapshot().data) !== fingerprint || chatStore.hasPending()) {
          if (!this.valid(epoch)) return;
          this.emit({ status: 'local', message: 'Есть новые локальные изменения. Синхронизация продолжится после завершения запроса.' });
          this.schedule(); return;
        }
        if (!this.valid(epoch)) return;
        if (remote.state) {
          const remoteHash = await hash(remote.state);
          if (!this.valid(epoch)) return;
          if (chatStore.getSnapshot().data !== current || chatStore.hasPending()) {
            this.emit({ status: 'local', message: 'Есть новые локальные изменения.' });
            this.schedule(); return;
          }
          this.applying = true;
          if (remoteHash !== fingerprint && !(await chatStore.replaceAccountData(userId, remote.state))) throw new Error('Не удалось сохранить серверную копию на устройстве.');
          this.applying = false;
          this.meta = { ...this.meta, revision: remote.revision, fingerprint: remoteHash };
          await AsyncStorage.setItem(metaKey(userId), JSON.stringify(this.meta));
          if (!this.valid(epoch)) return;
          this.emit({ status: 'saved', message: 'История синхронизирована с аккаунтом.', savedAt: remote.updated_at });
        } else {
          await this.push(userId, epoch, current, fingerprint, controller.signal);
        }
      }
    } catch (error) {
      if (!this.valid(epoch)) return;
      this.emit({ status: error instanceof AccountHTTPError && error.status === 409 ? 'conflict' : 'offline',
        message: error instanceof Error ? error.message : 'Синхронизация недоступна. Копия остаётся на устройстве.' });
    } finally {
      if (this.valid(epoch)) { this.busy = false; this.applying = false; this.controller = undefined; }
    }
  };
  private async push(userId: string, epoch: number, state: StoredData, fingerprint: string, signal: AbortSignal) {
    if (!this.valid(epoch)) return;
    const value = await accountRequest('account/state', { base_revision: this.meta.revision, state }, signal);
    if (!this.valid(epoch)) return;
    if (!record(value) || !Number.isInteger(value.revision) || typeof value.updated_at !== 'string') throw new Error('Не удалось подтвердить сохранение на сервере.');
    this.meta = { ...this.meta, revision: Number(value.revision), fingerprint };
    await AsyncStorage.setItem(metaKey(userId), JSON.stringify(this.meta));
    if (!this.valid(epoch)) return;
    const clean = await hash(chatStore.getSnapshot().data) === fingerprint;
    if (!this.valid(epoch)) return;
    this.emit({ status: clean ? 'saved' : 'local', message: clean ? 'История сохранена в аккаунте.' : 'Есть новые локальные изменения.', savedAt: value.updated_at });
    if (!clean) this.schedule();
  }
  mergeConflict = async () => {
    const userId = this.userId, epoch = this.epoch;
    if (!userId || this.busy || chatStore.hasPending()) return;
    this.busy = true;
    const controller = new AbortController(); this.controller = controller;
    try {
      const local = chatStore.getSnapshot().data, before = await hash(local);
      if (!this.valid(epoch)) return;
      const remote = await this.remote(controller.signal);
      if (!this.valid(epoch)) return;
      if (await hash(chatStore.getSnapshot().data) !== before || chatStore.hasPending()) throw new Error('Локальные сведения изменились. Повторите объединение после завершения запроса.');
      if (!this.valid(epoch)) return;
      const merged = remote.state ? mergeCopies(remote.state, local) : local;
      this.applying = true;
      if (!(await chatStore.replaceAccountData(userId, merged))) throw new Error('Не удалось сохранить объединённую историю на устройстве.');
      if (!this.valid(epoch)) return;
      this.meta.revision = remote.revision;
      await this.push(userId, epoch, merged, await hash(merged), controller.signal);
    } catch (error) {
      if (this.valid(epoch)) this.emit({ status: 'conflict', message: error instanceof Error ? error.message : 'Не удалось объединить историю. Обе копии сохранены.' });
    } finally { if (this.valid(epoch)) { this.busy = false; this.applying = false; this.controller = undefined; } }
  };
  importLegacy = async () => {
    const userId = this.userId, epoch = this.epoch;
    if (!userId || this.busy || this.state.status === 'conflict' || chatStore.hasPending()) return;
    this.busy = true;
    let imported = false;
    this.emit({ status: 'syncing', message: 'Переносим старую историю в выбранный аккаунт…' });
    try {
      const owner = await AsyncStorage.getItem(LEGACY_OWNER);
      if (!this.valid(epoch)) return;
      if (owner && owner !== userId) throw new Error('Старая история уже перенесена в другой аккаунт.');
      const old = await chatRepository.load(), fingerprint = await hash(old);
      if (!this.valid(epoch)) return;
      if (fingerprint === this.meta.imported) {
        this.emit({ status: 'local', message: 'Эта история уже перенесена в аккаунт.', legacyCount: 0 });
        this.schedule(); return;
      }
      await AsyncStorage.setItem(LEGACY_OWNER, userId);
      if (!this.valid(epoch)) return;
      const merged = mergeCopies(chatStore.getSnapshot().data, old);
      if (!(await chatStore.replaceAccountData(userId, merged))) throw new Error('Не удалось сохранить перенос. Исходная история остаётся на устройстве.');
      if (!this.valid(epoch)) return;
      this.meta.imported = fingerprint;
      await AsyncStorage.setItem(metaKey(userId), JSON.stringify(this.meta));
      if (!this.valid(epoch)) return;
      this.emit({ status: 'local', message: 'Старые чаты перенесены. Исходная локальная копия сохранена.', legacyCount: 0 });
      imported = true;
    } catch (error) { if (this.valid(epoch)) this.emit({ status: 'offline', message: error instanceof Error ? error.message : 'Не удалось перенести историю.' }); }
    finally { if (this.valid(epoch)) this.busy = false; }
    if (imported && this.valid(epoch)) await this.refresh();
  };
}

export const accountSync = new AccountSync();
export const useAccountSync = () => useSyncExternalStore(accountSync.subscribe, accountSync.getSnapshot, accountSync.getSnapshot);

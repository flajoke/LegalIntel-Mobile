import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { isAccountUser, type AccountUser } from '@/domain/account';
import { record } from '@/domain/salary';
import { AccountHTTPError, accountRequest, bindSessionAccount, loadSessionToken, onUnauthorized, saveSessionToken } from '@/services/session';
import { chatStore } from './chatStore';
import { accountSync } from './accountSync';

type AuthState = { status: 'loading' | 'anonymous' | 'authenticated'; user: AccountUser | null; busy: boolean; error: string };
class AuthStore {
  private state: AuthState = { status: 'loading', user: null, busy: false, error: '' };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private initial?: Promise<void>;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = () => this.state;
  private emit(patch: Partial<AuthState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private async accept(user: AccountUser, epoch: number) {
    bindSessionAccount(user.id);
    if (!(await chatStore.bindAccount(user.id))) throw new Error('Не удалось прочитать локальную копию аккаунта. Данные не удалены.');
    if (epoch !== this.epoch) return;
    await accountSync.start(user.id);
    if (epoch === this.epoch) this.emit({ status: 'authenticated', user, busy: false, error: '' });
  }
  initialize = async () => {
    if (this.initial) return this.initial;
    const epoch = ++this.epoch;
    this.emit({ status: 'loading', busy: true, error: '' });
    const task = (async () => {
      try {
        await loadSessionToken(); bindSessionAccount(null);
        const user = await accountRequest('auth/me');
        if (!isAccountUser(user)) throw new Error('Не удалось проверить аккаунт.');
        if (epoch === this.epoch) await this.accept(user, epoch);
      } catch (error) {
        if (epoch !== this.epoch) return;
        accountSync.stop(); bindSessionAccount(null);
        await chatStore.bindAccount(null);
        if (epoch !== this.epoch) return;
        if (error instanceof AccountHTTPError && error.status === 401) await saveSessionToken(null);
        this.emit({ status: 'anonymous', user: null, busy: false, error: error instanceof AccountHTTPError && error.status === 401 ? '' : error instanceof Error ? error.message : 'Не удалось войти.' });
      }
    })();
    this.initial = task;
    try { await task; } finally { if (this.initial === task) this.initial = undefined; }
  };
  login = async (username: string, password: string, register: boolean) => {
    if (this.state.busy) return;
    const epoch = ++this.epoch;
    this.emit({ busy: true, error: '' });
    try {
      bindSessionAccount(null);
      const result = await accountRequest(register ? 'auth/register' : 'auth/login', { username: username.trim(), password, device: Platform.OS === 'web' ? 'web' : 'native' });
      if (!record(result) || !isAccountUser(result.user) || (Platform.OS !== 'web' && typeof result.token !== 'string')) throw new Error('Не удалось проверить сеанс.');
      if (epoch !== this.epoch) return;
      await saveSessionToken(Platform.OS === 'web' ? null : result.token as string);
      if (epoch === this.epoch) await this.accept(result.user, epoch);
    } catch (error) {
      if (epoch !== this.epoch) return;
      accountSync.stop(); bindSessionAccount(null);
      await chatStore.bindAccount(null);
      if (epoch === this.epoch) this.emit({ status: 'anonymous', user: null, busy: false, error: error instanceof Error ? error.message : 'Не удалось войти.' });
    }
  };
  logout = async () => {
    if (this.state.busy) return;
    const epoch = this.epoch;
    this.emit({ busy: true, error: '' });
    try {
      await accountSync.refresh();
      if (epoch !== this.epoch) return;
      await accountRequest('auth/logout', {});
      if (epoch !== this.epoch) return;
      ++this.epoch; accountSync.stop(); bindSessionAccount(null);
      await saveSessionToken(null).catch(() => undefined); await chatStore.bindAccount(null);
      this.emit({ status: 'anonymous', user: null, busy: false, error: '' });
    } catch (error) { if (epoch === this.epoch) this.emit({ busy: false, error: error instanceof Error ? error.message : 'Не удалось завершить сеанс.' }); }
  };
  expire = async () => {
    if (this.state.status !== 'authenticated') return;
    ++this.epoch; accountSync.stop(); bindSessionAccount(null);
    this.emit({ status: 'loading', busy: true });
    await saveSessionToken(null).catch(() => undefined); await chatStore.bindAccount(null);
    this.emit({ status: 'anonymous', user: null, busy: false, error: 'Сеанс завершён или аккаунт изменился. Войдите снова. Локальная история сохранена отдельно для каждого аккаунта.' });
  };
}
export const authStore = new AuthStore();
onUnauthorized(() => { void authStore.expire(); });
export const useAuthState = () => useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);

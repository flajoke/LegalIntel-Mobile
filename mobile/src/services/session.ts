import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ApiError, defaultApiUrl, normalizeApiUrl } from './apiBase';

let token: string | null = null;
let accountId: string | null = null;
let unauthorized: (() => void) | null = null;
const KEY = 'legalintel.session.v1';
export class AccountHTTPError extends ApiError {
  constructor(message: string, public status: number, public code: string) { super(message); }
}
export function bindSessionAccount(id: string | null) { accountId = id; }
export function onUnauthorized(callback: () => void) { unauthorized = callback; }
export async function loadSessionToken() { token = Platform.OS === 'web' ? null : await SecureStore.getItemAsync(KEY); }
export async function saveSessionToken(value: string | null) {
  token = value;
  if (Platform.OS !== 'web') {
    if (value) await SecureStore.setItemAsync(KEY, value); else await SecureStore.deleteItemAsync(KEY);
  }
}
export async function sessionFetch(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (accountId) headers.set('X-Account-ID', accountId);
  const response = await fetch(url, { ...init, headers, credentials: 'include' });
  if (response.status === 401 && accountId) unauthorized?.();
  return response;
}
export async function accountRequest(path: string, payload?: unknown, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 15000);
  try {
    const response = await sessionFetch(`${normalizeApiUrl(defaultApiUrl())}/api/v1/${path}`, {
      method: payload === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload), signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new AccountHTTPError(typeof data?.error?.message === 'string' ? data.error.message : 'Не удалось выполнить запрос аккаунта.', response.status, String(data?.error?.code ?? 'account_error'));
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(signal?.aborted ? 'Запрос остановлен.' : 'Не удалось подключиться к LegalIntel. Попробуйте ещё раз.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

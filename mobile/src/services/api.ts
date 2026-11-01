import Constants from 'expo-constants';
import { Platform } from 'react-native';

export class ApiError extends Error {}

export function normalizeApiUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new ApiError('Введите адрес вида http://192.168.1.10:8000'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new ApiError('Укажите только http(s)://адрес:порт, без пути, пароля и параметров.');
  }
  return url.origin;
}

export function defaultApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `http://${window.location.hostname}:8000`;
  }
  // Expo's LAN host points to the development computer, not the phone itself.
  const hostUri = Constants.expoConfig?.hostUri;
  const hostname = hostUri ? hostUri.split(':')[0] : '';
  if (hostname && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
    return `http://${hostname}:8000`;
  }
  return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
}

type ChatPayload = {
  conversation_id: string;
  client_message_id: string;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
};

type ChatResponse = {
  conversation_id: string;
  client_message_id: string;
  mode: 'stub';
  request_id: string;
  message: { id: string; role: 'assistant'; content: string; created_at: string };
};

async function request(baseUrl: string, path: string, init: RequestInit, parentSignal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  parentSignal?.addEventListener('abort', abort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  try {
    const response = await fetch(`${normalizeApiUrl(baseUrl)}${path}`, { ...init, signal: controller.signal });
    let data: any;
    try { data = await response.json(); } catch { throw new ApiError('Сервер вернул некорректный ответ. Проверьте адрес подключения.'); }
    if (!response.ok) {
      throw new ApiError(typeof data?.error?.message === 'string' ? data.error.message : `Сервер вернул ошибку ${response.status}.`);
    }
    return data;
  } catch (error) {
    if (parentSignal?.aborted) throw new ApiError('Отправка остановлена. Можно повторить её позже.');
    if (timedOut) throw new ApiError('Сервер не ответил за 20 секунд. Попробуйте ещё раз.');
    if (error instanceof ApiError) throw error;
    throw new ApiError('Не удалось связаться с сервером. Попробуйте ещё раз.');
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abort);
  }
}

export async function sendChat(baseUrl: string, payload: ChatPayload, signal: AbortSignal): Promise<ChatResponse> {
  const data = await request(baseUrl, '/api/v1/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }, signal) as Partial<ChatResponse> | null;
  if (!data || data.conversation_id !== payload.conversation_id
    || data.client_message_id !== payload.client_message_id || data.mode !== 'stub'
    || typeof data.request_id !== 'string' || typeof data.message?.id !== 'string'
    || data.message.role !== 'assistant' || typeof data.message.content !== 'string'
    || !data.message.content.trim() || !Number.isFinite(Date.parse(data.message.created_at))) {
    throw new ApiError('Формат ответа сервера не совпадает с версией приложения.');
  }
  return data as ChatResponse;
}

export async function checkHealth(baseUrl: string, signal: AbortSignal): Promise<string> {
  const data = await request(baseUrl, '/health', { method: 'GET' }, signal) as Record<string, unknown> | null;
  if (data?.status !== 'ok' || data.reply_mode !== 'stub' || typeof data.version !== 'string') {
    throw new ApiError('По этому адресу не найден совместимый сервер LegalIntel.');
  }
  return data.version;
}

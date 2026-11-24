import { isSalaryAnalysis, type AnalysisOptions, type SalaryAnalysis } from '@/domain/analysis';
import { isAIResult, type AIAction, type AICandidate, type AIResult } from '@/domain/ai';
import { isCorpus, isExcerpt, isSalaryCase, isSource, record, type CorpusStatus, type LegalDocument, type LegalSource, type SalaryAction, type SalaryCase, type SourceExcerpt } from '@/domain/salary';
import { ApiError, defaultApiUrl, normalizeApiUrl } from './apiBase';
import { sessionFetch } from './session';
export { ApiError, defaultApiUrl, normalizeApiUrl } from './apiBase';

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

async function request(baseUrl: string, path: string, init: RequestInit, parentSignal?: AbortSignal, timeoutMs = 20000): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  parentSignal?.addEventListener('abort', abort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await sessionFetch(`${normalizeApiUrl(baseUrl)}${path}`, { ...init, signal: controller.signal });
    let data: any;
    try { data = await response.json(); } catch { throw new ApiError('Сервер вернул некорректный ответ. Проверьте адрес подключения.'); }
    if (!response.ok) {
      throw new ApiError(typeof data?.error?.message === 'string' ? data.error.message : `Сервер вернул ошибку ${response.status}.`);
    }
    return data;
  } catch (error) {
    if (parentSignal?.aborted) throw new ApiError('Отправка остановлена. Можно повторить её позже.');
    if (timedOut) throw new ApiError('Сервер не ответил вовремя. Попробуйте ещё раз.');
    if (error instanceof ApiError) throw error;
    throw new ApiError('Не удалось связаться с сервером. Попробуйте ещё раз.');
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abort);
  }
}

type SalaryResponse = Omit<ChatResponse, 'mode'> & { mode: 'guided'; case: SalaryCase };
export async function sendAITurn(baseUrl: string, payload: {
  conversation_id: string; client_message_id: string; message: string; action: AIAction;
  state?: SalaryCase; candidates: AICandidate[]; as_of_date: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}, signal: AbortSignal): Promise<AIResult> {
  const state = payload.state ? {
    version: payload.state.version, description: payload.state.description,
    answers: payload.state.answers, confirmed: payload.state.confirmed,
  } : null;
  const history: typeof payload.history = [];
  let count = 0;
  for (const m of [...payload.history].reverse()) {
    if (history.length === 6 || count + m.content.length > 6000) break;
    if (m.content.length > 4000) continue;
    history.unshift(m); count += m.content.length;
  }
  const data = await request(baseUrl, '/api/v1/ai/turn', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      ...payload, state, history,
      candidates: payload.candidates.map(({ field, value, evidence }) => ({ field, value, evidence })),
    }),
  }, signal, 270000);
  if (!isAIResult(data) || data.conversation_id !== payload.conversation_id || data.client_message_id !== payload.client_message_id) {
    throw new ApiError('Не удалось прочитать ответ помощника. Обновите приложение и попробуйте ещё раз.');
  }
  return data;
}
export async function sendSalaryTurn(baseUrl: string, payload: {
  conversation_id: string; client_message_id: string; message: string; action: SalaryAction; state: SalaryCase | undefined;
}, signal: AbortSignal): Promise<SalaryResponse> {
  const state = payload.state ? {
    version: payload.state.version, description: payload.state.description,
    answers: payload.state.answers, confirmed: payload.state.confirmed,
  } : null;
  const data = await request(baseUrl, '/api/v1/salary-delay/turn', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, state }),
  }, signal) as Partial<SalaryResponse> | null;
  if (!data || data.conversation_id !== payload.conversation_id || data.client_message_id !== payload.client_message_id
    || data.mode !== 'guided' || !isSalaryCase(data.case) || typeof data.request_id !== 'string'
    || typeof data.message?.id !== 'string' || data.message.role !== 'assistant' || typeof data.message.content !== 'string'
    || !data.message.content.trim() || !Number.isFinite(Date.parse(data.message.created_at))) {
    throw new ApiError('Не удалось прочитать сведения по выплате. Обновите приложение и попробуйте ещё раз.');
  }
  return data as SalaryResponse;
}

export async function getKnowledge(query: string, signal: AbortSignal): Promise<{ corpus: CorpusStatus; documents: (LegalSource | SourceExcerpt)[] }> {
  const data = await request(defaultApiUrl(), query ? `/api/v1/knowledge/search?q=${encodeURIComponent(query)}` : '/api/v1/knowledge', { method: 'GET' }, signal);
  if (!record(data) || !isCorpus(data.corpus)) throw new ApiError('Не удалось прочитать правовую базу.');
  const documents = query ? data.results : data.documents;
  if (!Array.isArray(documents) || !documents.every(query ? isExcerpt : isSource)) throw new ApiError('Не удалось прочитать источники.');
  return { corpus: data.corpus, documents: documents as (LegalSource | SourceExcerpt)[] };
}

export async function analyzeSalary(conversationId: string, value: SalaryCase, options: AnalysisOptions, signal: AbortSignal): Promise<SalaryAnalysis> {
  const data = await request(defaultApiUrl(), '/api/v1/salary-delay/analysis', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      conversation_id: conversationId,
      state: { version: value.version, description: value.description, answers: value.answers, confirmed: value.confirmed }, options,
    }),
  }, signal);
  if (!record(data) || data.conversation_id !== conversationId || typeof data.request_id !== 'string' || !isSalaryAnalysis(data.analysis)
    || data.analysis.as_of_date !== value.metrics.as_of_date) {
    throw new ApiError('Не удалось прочитать анализ выплаты. Обновите приложение и попробуйте ещё раз.');
  }
  return data.analysis;
}

export async function getLegalDocument(id: string, signal: AbortSignal): Promise<LegalDocument> {
  const data = await request(defaultApiUrl(), `/api/v1/knowledge/documents/${encodeURIComponent(id)}`, { method: 'GET' }, signal);
  if (!record(data) || typeof data.text !== 'string' || !Array.isArray(data.chunks)
    || !data.chunks.every(c => record(c) && typeof c.text === 'string' && typeof c.id === 'string'
      && Number.isInteger(c.position) && Number.isInteger(c.start_offset) && Number.isInteger(c.end_offset))) {
    throw new ApiError('Не удалось прочитать текст источника.');
  }
  if (!isSource(data)) throw new ApiError('Не удалось прочитать реквизиты источника.');
  return data as unknown as LegalDocument;
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

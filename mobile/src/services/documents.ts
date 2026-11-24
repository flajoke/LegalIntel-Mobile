import { Platform } from 'react-native';
import { File as ExpoFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { defaultAnalysisOptions, type AnalysisOptions } from '@/domain/analysis';
import { isLetterDraftResult, type DocumentDraft, type LetterDetails, type LetterDraftResult, type LetterTemplate } from '@/domain/documents';
import type { SalaryCase } from '@/domain/salary';
import { ApiError, defaultApiUrl, normalizeApiUrl } from './apiBase';
import { sessionFetch } from './session';

const mime = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
async function post<T>(path: string, payload: unknown, signal: AbortSignal, read: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 30000);
  try {
    const response = await sessionFetch(`${normalizeApiUrl(defaultApiUrl())}/api/v1/salary-delay/documents/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new ApiError(typeof data?.error?.message === 'string' ? data.error.message : 'Не удалось подготовить документ.');
    }
    return await read(response);
  } catch (error) {
    if (signal.aborted) throw new ApiError('Подготовка документа остановлена.');
    if (error instanceof ApiError) throw error;
    throw new ApiError('Не удалось получить документ. Проверьте соединение и попробуйте ещё раз.');
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export async function createLetterDraft(conversationId: string, documentId: string, template: LetterTemplate, value: SalaryCase,
  details: LetterDetails, options: AnalysisOptions | undefined, signal: AbortSignal): Promise<LetterDraftResult> {
  const data: unknown = await post('draft', { conversation_id: conversationId, document_id: documentId, template, details,
    state: { version: value.version, description: value.description, answers: value.answers, confirmed: value.confirmed },
    analysis_options: options ?? defaultAnalysisOptions(),
  }, signal, response => response.json());
  if (!isLetterDraftResult(data) || data.conversation_id !== conversationId || data.document_id !== documentId || data.template !== template) {
    throw new ApiError('Не удалось прочитать черновик. Обновите приложение и попробуйте ещё раз.');
  }
  return data;
}
export async function exportLetter(draft: DocumentDraft, format: 'pdf' | 'docx', signal: AbortSignal): Promise<void> {
  const bytes = await post('export', { document_id: draft.id, template: draft.template, format, text: draft.text, reviewed: draft.reviewed }, signal, async response => {
    if (!response.headers.get('Content-Type')?.startsWith(mime[format])) throw new ApiError('Сервер вернул неверный формат файла.');
    if (Number(response.headers.get('Content-Length')) > 5_000_000) throw new ApiError('Получен слишком большой файл.');
    return response.arrayBuffer();
  });
  if (signal.aborted) throw new ApiError('Экспорт остановлен.');
  if (bytes.byteLength < 50 || bytes.byteLength > 5_000_000) throw new ApiError('Получен некорректный размер файла.');
  const filename = `legalintel-${draft.template}-${draft.id.replace(/[^a-z0-9-]/gi, '')}.${format}`;
  if (Platform.OS === 'web') {
    const blob = new Blob([bytes], { type: mime[format] });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    if (!(await Sharing.isAvailableAsync())) throw new ApiError('На устройстве недоступно сохранение через системное меню.');
    if (signal.aborted) throw new ApiError('Экспорт остановлен.');
    const file = new ExpoFile(Paths.cache, filename.replace(/\.(pdf|docx)$/, `-${Date.now()}.${format}`));
    await file.create({ overwrite: true });
    await file.write(new Uint8Array(bytes));
    if (signal.aborted) return;
    await Sharing.shareAsync(file.uri, { mimeType: mime[format], dialogTitle: 'Сохранить обращение',
      UTI: format === 'pdf' ? 'com.adobe.pdf' : 'org.openxmlformats.wordprocessingml.document' });
  }
}

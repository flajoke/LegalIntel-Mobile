import { isExcerpt, isSalaryCase, record, type SalaryCase, type SourceExcerpt } from './salary';

export type AIAction = 'message' | 'accept' | 'dismiss' | 'confirm';
export type AICandidate = {
  field: string; value: string | null; evidence: string;
  label: string; display_value: string; previous_value: string | null;
};
export type AIResult = {
  conversation_id: string; client_message_id: string; mode: 'ai'; request_id: string; prompt_version: string;
  message: { id: string; role: 'assistant'; content: string; created_at: string };
  case: SalaryCase; candidates: AICandidate[]; sources: SourceExcerpt[];
};
export function isAIAction(value: unknown): value is AIAction {
  return ['message', 'accept', 'dismiss', 'confirm'].includes(String(value));
}
export function isCandidate(value: unknown): value is AICandidate {
  return record(value) && ['field', 'evidence', 'label', 'display_value'].every(k => typeof value[k] === 'string')
    && (value.value === null || typeof value.value === 'string')
    && (value.previous_value === null || typeof value.previous_value === 'string');
}
export function isAIResult(value: unknown): value is AIResult {
  return record(value) && value.mode === 'ai'
    && ['conversation_id', 'client_message_id', 'request_id', 'prompt_version'].every(k => typeof value[k] === 'string')
    && record(value.message) && typeof value.message.id === 'string' && value.message.role === 'assistant'
    && typeof value.message.content === 'string' && !!value.message.content.trim()
    && typeof value.message.created_at === 'string' && Number.isFinite(Date.parse(value.message.created_at))
    && isSalaryCase(value.case) && Array.isArray(value.candidates) && value.candidates.every(isCandidate)
    && Array.isArray(value.sources) && value.sources.every(isExcerpt);
}

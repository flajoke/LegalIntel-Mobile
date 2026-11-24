export type SalaryAction = { kind: 'start' | 'answer' | 'edit' | 'confirm' | 'refresh'; field?: string; value?: string | null };
export type SalaryQuestion = {
  field: string; label: string; prompt: string; kind: 'choice' | 'multi' | 'date' | 'money' | 'text';
  hint: string; options: { value: string; label: string }[]; allow_unknown: boolean;
};
export type LegalSource = {
  id: string; citation: string; title: string; source_url: string; publisher: string;
  edition: string; checked_on: string; source_type: 'normative' | 'expert'; sha256: string;
};
export type SourceExcerpt = LegalSource & { chunk_id: string; excerpt: string };
export type CorpusStatus = { version: string; checked_on: string; documents: number; chunks: number };
export type LegalDocument = LegalSource & { text: string; chunks: { id: string; position: number; start_offset: number; end_offset: number; text: string }[] };
export type SalaryCase = {
  version: 1; description: string; answers: Record<string, string | null>; confirmed: boolean;
  status: 'collecting' | 'review' | 'complete' | 'outside_scope'; question: SalaryQuestion | null;
  fields: SalaryQuestion[]; progress: { answered: number; total: number };
  summary: { field: string; label: string; value: string }[]; notices: string[];
  metrics: { delay_days: number | null; remaining_amount: string | null; as_of_date: string };
  sources: SourceExcerpt[]; corpus: CorpusStatus;
};

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string');
export function isSalaryAction(value: unknown): value is SalaryAction {
  return record(value) && ['start', 'answer', 'edit', 'confirm', 'refresh'].includes(String(value.kind))
    && (value.field === undefined || typeof value.field === 'string')
    && (value.value === undefined || value.value === null || typeof value.value === 'string');
}
export function isQuestion(value: unknown): value is SalaryQuestion {
  return record(value) && strings(value, ['field', 'label', 'prompt', 'hint'])
    && ['choice', 'multi', 'date', 'money', 'text'].includes(String(value.kind)) && typeof value.allow_unknown === 'boolean'
    && Array.isArray(value.options) && value.options.every(o => record(o) && strings(o, ['value', 'label']));
}
export function isSource(value: unknown): value is LegalSource {
  return record(value) && strings(value, ['id', 'citation', 'title', 'source_url', 'publisher', 'edition', 'checked_on', 'sha256'])
    && ['normative', 'expert'].includes(String(value.source_type)) && /^https:\/\//.test(String(value.source_url));
}
export function isExcerpt(value: unknown): value is SourceExcerpt {
  return isSource(value) && record(value) && strings(value, ['chunk_id', 'excerpt']);
}
export function isCorpus(value: unknown): value is CorpusStatus {
  return record(value) && strings(value, ['version', 'checked_on']) && Number.isInteger(value.documents) && Number.isInteger(value.chunks);
}
export function isSalaryCase(value: unknown): value is SalaryCase {
  return record(value) && value.version === 1 && typeof value.description === 'string' && typeof value.confirmed === 'boolean'
    && record(value.answers) && Object.values(value.answers).every(v => v === null || typeof v === 'string')
    && ['collecting', 'review', 'complete', 'outside_scope'].includes(String(value.status))
    && (value.question === null || isQuestion(value.question)) && Array.isArray(value.fields) && value.fields.every(isQuestion)
    && record(value.progress) && Number.isInteger(value.progress.answered) && Number.isInteger(value.progress.total)
    && Array.isArray(value.summary) && value.summary.every(r => record(r) && strings(r, ['field', 'label', 'value']))
    && Array.isArray(value.notices) && value.notices.every(n => typeof n === 'string')
    && record(value.metrics) && (value.metrics.delay_days === null || Number.isInteger(value.metrics.delay_days))
    && (value.metrics.remaining_amount === null || typeof value.metrics.remaining_amount === 'string')
    && typeof value.metrics.as_of_date === 'string' && Array.isArray(value.sources) && value.sources.every(isExcerpt) && isCorpus(value.corpus);
}
export function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function readableDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('.') : value;
}

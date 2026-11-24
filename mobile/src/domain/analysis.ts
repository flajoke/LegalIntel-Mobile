import { isCorpus, isSource, record, type CorpusStatus, type LegalSource, type SalaryCase } from './salary';

export type AnalysisOptions = {
  deadline_mode: 'unverified' | 'already_adjusted' | 'federal_five_day';
  amount_basis: 'unknown' | 'accrued';
  payment_history_complete: boolean;
  payments: { date: string; amount: string }[];
};
export type SavedAnalysisOptions = { caseFingerprint: string; options: AnalysisOptions };
export type AnalysisFinding = {
  id: string; title: string; status: 'supports' | 'attention' | 'missing' | 'info'; explanation: string;
  facts: { label: string; value: string }[]; source_ids: string[];
};
export type AnalysisItem = { id: string; title: string; text: string; source_ids: string[] };
export type SalaryAnalysis = {
  status: 'needs_confirmation' | 'outside_scope' | 'needs_review' | 'needs_facts' | 'possible_delay' | 'paid_late' | 'no_delay_detected';
  title: string; summary: string; as_of_date: string;
  data_quality: 'sufficient' | 'limited' | 'insufficient'; data_quality_explanation: string;
  missing: string[]; findings: AnalysisFinding[];
  deadline: { date: string | null; basis: string; delay_days: number | null; calendar_source_url: string | null };
  remaining_amount: string | null;
  compensation: {
    status: 'calculated' | 'not_needed' | 'unavailable'; amount: string | null; explanation: string; formula: string;
    segments: { start: string; end: string; days: number; principal: string; rate_percent: string; amount: string }[];
    missing: string[]; rate_source_url: string; rates_checked_through: string;
  };
  next_steps: AnalysisItem[]; documents: AnalysisItem[]; lawyer_reasons: string[]; sources: LegalSource[];
  corpus: CorpusStatus; rules: { version: string; valid_from: string; checked_through: string; legal_reviewed: boolean };
  limitations: string[]; disclaimer: string;
};

export const defaultAnalysisOptions = (): AnalysisOptions => ({ deadline_mode: 'unverified', amount_basis: 'unknown', payment_history_complete: false, payments: [] });
export function caseFingerprint(value: SalaryCase): string {
  return JSON.stringify({ version: value.version, description: value.description, confirmed: value.confirmed,
    answers: Object.fromEntries(Object.entries(value.answers).sort(([a], [b]) => a.localeCompare(b))) });
}
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
const iso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const money = (v: unknown) => typeof v === 'string' && /^\d{1,14}\.\d{2}$/.test(v);
const cbr = (v: unknown) => typeof v === 'string' && /^https:\/\/www\.cbr\.ru\//.test(v);
export function isAnalysisOptions(v: unknown): v is AnalysisOptions {
  return record(v) && ['unverified', 'already_adjusted', 'federal_five_day'].includes(String(v.deadline_mode))
    && ['unknown', 'accrued'].includes(String(v.amount_basis)) && typeof v.payment_history_complete === 'boolean'
    && Array.isArray(v.payments) && v.payments.length <= 50 && v.payments.every(p => record(p) && iso(p.date)
      && typeof p.amount === 'string' && /^\d{1,10}(?:\.\d{1,2})?$/.test(p.amount) && Number(p.amount) > 0 && Number(p.amount) <= 1e9);
}
export function isSavedAnalysisOptions(v: unknown): v is SavedAnalysisOptions {
  return record(v) && typeof v.caseFingerprint === 'string' && v.caseFingerprint.length <= 32000 && isAnalysisOptions(v.options);
}
function isItem(v: unknown): v is AnalysisItem {
  return record(v) && strings(v, ['id', 'title', 'text']) && texts(v.source_ids);
}
export function isSalaryAnalysis(v: unknown): v is SalaryAnalysis {
  if (!record(v) || !strings(v, ['title', 'summary', 'data_quality_explanation', 'disclaimer']) || !iso(v.as_of_date)
    || !['needs_confirmation', 'outside_scope', 'needs_review', 'needs_facts', 'possible_delay', 'paid_late', 'no_delay_detected'].includes(String(v.status))
    || !['sufficient', 'limited', 'insufficient'].includes(String(v.data_quality)) || !texts(v.missing) || !texts(v.lawyer_reasons) || !texts(v.limitations)
    || !Array.isArray(v.findings) || !v.findings.every(f => record(f) && strings(f, ['id', 'title', 'explanation'])
      && ['supports', 'attention', 'missing', 'info'].includes(String(f.status)) && texts(f.source_ids)
      && Array.isArray(f.facts) && f.facts.every(x => record(x) && strings(x, ['label', 'value'])))
    || !Array.isArray(v.next_steps) || !v.next_steps.every(isItem) || !Array.isArray(v.documents) || !v.documents.every(isItem)
    || !Array.isArray(v.sources) || !v.sources.every(isSource) || !isCorpus(v.corpus)
    || !record(v.rules) || !strings(v.rules, ['version']) || !iso(v.rules.valid_from) || !iso(v.rules.checked_through) || typeof v.rules.legal_reviewed !== 'boolean'
    || !record(v.deadline) || typeof v.deadline.basis !== 'string' || !(v.deadline.date === null || iso(v.deadline.date))
    || !(v.deadline.delay_days === null || (Number.isInteger(v.deadline.delay_days) && Number(v.deadline.delay_days) >= 0))
    || !(v.deadline.calendar_source_url === null || cbr(v.deadline.calendar_source_url)) || !(v.remaining_amount === null || money(v.remaining_amount))) return false;
  const c = v.compensation;
  if (!record(c) || !['calculated', 'not_needed', 'unavailable'].includes(String(c.status)) || !(c.amount === null || money(c.amount))
    || !strings(c, ['explanation', 'formula']) || !texts(c.missing) || !cbr(c.rate_source_url) || !iso(c.rates_checked_through)
    || !Array.isArray(c.segments) || !c.segments.every(s => record(s) && iso(s.start) && iso(s.end)
      && Number.isInteger(s.days) && Number(s.days) > 0 && money(s.principal) && money(s.amount)
      && typeof s.rate_percent === 'string' && /^\d+(?:\.\d+)?$/.test(s.rate_percent))) return false;
  const ids = new Set(v.sources.map(s => s.id));
  // Out-of-scope cases deliberately have no Russian source suggestions.
  return v.status === 'outside_scope' || [...v.findings, ...v.next_steps, ...v.documents].every(i => (i as AnalysisItem).source_ids.every(id => ids.has(id)));
}

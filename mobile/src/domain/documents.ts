import { isSource, localDate, record, type LegalSource } from './salary';

export type LetterTemplate = 'employer' | 'labor_inspectorate';
export type LetterDetails = {
  document_date: string; applicant_name: string; applicant_address: string; applicant_contact: string;
  employer_name: string; employer_address: string; inspectorate_name: string; job_title: string;
  additional_facts: string; attachments: string; request_compensation: boolean;
};
export type LetterDraftResult = {
  conversation_id: string; document_id: string; template: LetterTemplate; template_version: string;
  title: string; text: string; missing: string[]; warnings: string[]; sources: LegalSource[]; created_at: string; request_id: string;
};
export type DocumentDraft = {
  id: string; template: LetterTemplate; templateVersion: string; title: string; text: string;
  details: LetterDetails; caseFingerprint: string; createdAt: string; updatedAt: string;
  reviewed: boolean; warnings: string[]; sources: LegalSource[];
};
export const MAX_DOCUMENTS = 10;
export const MAX_DOCUMENT_TEXT = 30000;
export const templateLabel = (value: LetterTemplate) => value === 'employer' ? 'Работодателю' : 'В трудовую инспекцию';
export const emptyLetterDetails = (): LetterDetails => ({ document_date: localDate(), applicant_name: '', applicant_address: '',
  applicant_contact: '', employer_name: '', employer_address: '', inspectorate_name: '', job_title: '', additional_facts: '', attachments: '', request_compensation: true });
const textKeys = ['document_date', 'applicant_name', 'applicant_address', 'applicant_contact', 'employer_name', 'employer_address', 'inspectorate_name', 'job_title', 'additional_facts', 'attachments'];
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export const hasDocumentPlaceholders = (text: string) => /\[Укажите[^\]\n]*\]/i.test(text);
export function isLetterDetails(v: unknown): v is LetterDetails {
  return record(v) && textKeys.every(k => typeof v[k] === 'string' && String(v[k]).length <= (k === 'additional_facts' || k === 'attachments' ? 2000 : k.endsWith('_address') ? 600 : 300))
    && /^\d{4}-\d{2}-\d{2}$/.test(String(v.document_date)) && typeof v.request_compensation === 'boolean';
}
export function isLetterDraftResult(v: unknown): v is LetterDraftResult {
  return record(v) && uuid(v.conversation_id) && uuid(v.document_id) && ['employer', 'labor_inspectorate'].includes(String(v.template))
    && ['template_version', 'title', 'text', 'request_id', 'created_at'].every(k => typeof v[k] === 'string')
    && String(v.text).length <= MAX_DOCUMENT_TEXT && Number.isFinite(Date.parse(String(v.created_at)))
    && strings(v.missing) && strings(v.warnings) && Array.isArray(v.sources) && v.sources.every(isSource);
}
export function isDocumentDraft(v: unknown): v is DocumentDraft {
  return record(v) && uuid(v.id) && ['employer', 'labor_inspectorate'].includes(String(v.template))
    && ['templateVersion', 'title', 'text', 'caseFingerprint', 'createdAt', 'updatedAt'].every(k => typeof v[k] === 'string')
    && String(v.text).length <= MAX_DOCUMENT_TEXT && String(v.caseFingerprint).length <= 32000
    && Number.isFinite(Date.parse(String(v.createdAt))) && Number.isFinite(Date.parse(String(v.updatedAt)))
    && typeof v.reviewed === 'boolean' && strings(v.warnings) && Array.isArray(v.sources) && v.sources.every(isSource) && isLetterDetails(v.details);
}

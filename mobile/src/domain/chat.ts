export type ThemePreference = 'system' | 'light' | 'dark';
export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status: 'pending' | 'sent' | 'failed';
  error?: string;
  inReplyTo?: string;
  mode?: 'stub' | 'guided' | 'ai';
  scenarioAction?: SalaryAction;
  aiAction?: AIAction;
  sources?: SourceExcerpt[];
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  draft: string;
  messages: Message[];
  scenario?: 'salary_delay';
  salaryCase?: SalaryCase;
  assistantMode?: 'ai' | 'guided';
  aiCandidates?: AICandidate[];
  salaryAnalysis?: SavedAnalysisOptions;
  documentDrafts?: DocumentDraft[];
};

export type StoredData = {
  version: 3;
  conversations: Conversation[];
  activeId: string | null;
  newDraft: string;
  // apiUrl is retained only to read existing v1 data; configuration now comes from .env.
  settings: { apiUrl: string; theme: ThemePreference };
};

export function emptyData(): StoredData {
  return { version: 3, conversations: [], activeId: null, newDraft: '', settings: { apiUrl: '', theme: 'system' } };
}

export const MAX_MESSAGE_LENGTH = 4000;

// Only successfully completed turns go into context. Full local history is
// never truncated; this bounded window applies only to the HTTP request.
export function contextFor(messages: Message[]) {
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let characters = 0;
  for (const message of [...messages].reverse()) {
    if (message.status !== 'sent') continue;
    if (history.length >= 40 || characters + message.content.length > 20000) break;
    history.unshift({ role: message.role, content: message.content });
    characters += message.content.length;
  }
  return history;
}
import type { SalaryAction, SalaryCase, SourceExcerpt } from './salary';
import type { AIAction, AICandidate } from './ai';
import type { SavedAnalysisOptions } from './analysis';
import type { DocumentDraft } from './documents';

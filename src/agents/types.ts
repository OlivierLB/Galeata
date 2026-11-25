// Mirror of galeata-agent-protocol's `AgentEvent` (src-tauri/crates/agent-protocol/src/event.rs).
// `Option` fields arrive as `null`.

export type Provider = 'claude' | 'codex';
export type AgentState = 'starting' | 'idle' | 'working' | 'waitingApproval';
export type TurnStatus = 'completed' | 'interrupted' | 'failed';
export type ToolKind =
  'command' | 'fileRead' | 'fileEdit' | 'search' | 'web' | 'mcp' | 'agent' | 'other';
export type ApprovalKind = 'command' | 'fileChange' | 'tool';
export type Decision = 'allow' | 'allowForSession' | 'deny';

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  resolvedModel?: string | null;
}

export interface QuestionOption {
  label: string;
  description: string;
}
export interface Question {
  /** Answer key (question text for Claude, id for Codex). */
  id: string;
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
}
export type PlanAnswer = {
  kind: 'plan';
  approve: boolean;
  acceptEdits: boolean;
  feedback?: string;
};
export type RefuseAnswer = { kind: 'refuse'; message: string };
export type QuestionsAnswer = { kind: 'questions'; answers: { id: string; values: string[] }[] };

export interface FileChange {
  path: string;
  kind: string;
  diff: string;
}

export type AgentEvent =
  | { type: 'models'; models: ModelOption[] }
  | { type: 'model'; model: string }
  | { type: 'session'; sessionId: string; model: string | null }
  | { type: 'state'; state: AgentState }
  | { type: 'turnStarted' }
  | {
      type: 'turnCompleted';
      status: TurnStatus;
      error: string | null;
      costUsd: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | { type: 'userMessage'; itemId: string; text: string }
  | { type: 'textDelta'; itemId: string; text: string }
  | { type: 'message'; itemId: string; text: string }
  | { type: 'reasoning'; itemId: string; text: string }
  | { type: 'toolStarted'; itemId: string; tool: ToolKind; title: string; path: string | null }
  | { type: 'toolOutput'; itemId: string; text: string }
  | { type: 'toolCompleted'; itemId: string; ok: boolean; output: string | null }
  | { type: 'fileChanges'; itemId: string; changes: FileChange[] }
  | { type: 'turnDiff'; diff: string }
  | {
      type: 'approval';
      requestId: string;
      kind: ApprovalKind;
      title: string;
      detail: string | null;
      description: string | null;
      always: string | null;
    }
  | { type: 'mode'; mode: string }
  | { type: 'planProposal'; requestId: string; plan: string; path: string | null }
  | { type: 'plan'; itemId: string; text: string; historical?: boolean }
  | { type: 'question'; requestId: string; questions: Question[] }
  | { type: 'approvalResolved'; requestId: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; contextWindow: number | null }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | { type: 'exited'; code: number | null; stderr: string | null };

export interface ChatItem {
  id: string;
  kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'notice' | 'error' | 'plan' | 'question';
  text: string;
  streaming?: boolean;
  tool?: ToolKind;
  title?: string;
  path?: string | null;
  running?: boolean;
  ok?: boolean;
  output?: string;
  changes?: FileChange[];
  /** Plan and question cards: the pending request, then how it was answered. */
  requestId?: string;
  status?: 'pending' | 'ready' | 'approved' | 'refined' | 'answered' | 'closed';
  questions?: Question[];
  answer?: string;
}

export interface Approval {
  requestId: string;
  kind: ApprovalKind;
  title: string;
  detail: string | null;
  description: string | null;
  always: string | null;
}

export interface Conversation {
  id: string;
  provider: Provider;
  demo: boolean;
  state: AgentState | 'exited';
  /** Permission mode reported by the agent. */
  mode?: string;
  busy: boolean;
  queuedMessages: { id: string; text: string }[];
  queuePaused: boolean;
  sessionId?: string;
  model?: string | null;
  models: ModelOption[];
  items: ChatItem[];
  approvals: Approval[];
  turnDiff?: string;
  costUsd: number;
  usage?: { inputTokens: number; outputTokens: number; contextWindow: number | null };
  exit?: { code: number | null; stderr: string | null };
}

export const providerNames: Record<Provider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

export type StepStatus = 'pending' | 'in_progress' | 'blocked' | 'done';
export interface Step {
  id: string;
  title: string;
  status: StepStatus;
  note: string;
  author: string;
  updatedAt: number;
}
export interface Plan {
  revision: number;
  objective: string;
  steps: Step[];
  /** Full plan text (markdown) proposed or written by the agent. */
  document?: string;
  /** False for a plan taken from an older conversation: progress never tracked. */
  tracked?: boolean;
  /** When that plan was proposed (ISO 8601). */
  proposedAt?: string;
}
export interface Workspace {
  id: string;
  root: string;
  name: string;
}
export interface Entry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
}
export interface OpenFile {
  path: string;
  content: string;
  savedContent: string;
  stamp: string;
  language: string;
  external?: boolean;
}
export interface GitFile {
  path: string;
  index: string;
  worktree: string;
  conflicted?: boolean;
}
export interface GitStatus {
  branch: string;
  files: GitFile[];
  isRepo: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  detached?: boolean;
  merging?: boolean;
}
export interface GitBranch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string;
  inWorktree: boolean;
}
export interface GitStash {
  id: string;
  oid: string;
  message: string;
}
export interface GitOverview {
  branches: GitBranch[];
  stashes: GitStash[];
  remotes: string[];
}
export interface SearchHit {
  path: string;
  line: number;
  text: string;
}
export interface Session {
  id: string;
  provider: 'codex' | 'claude';
  /** Name given by the user, else the agent's generated title, else the first request. */
  title: string;
  /** True when `title` is a name given in the CLI (rename). */
  named?: boolean;
  /** Last request typed in the session (what was being done). */
  description?: string;
  branch?: string | null;
  path: string;
  modifiedAt: number;
  summary: string;
  parentId?: string;
}
export interface Provider {
  id: string;
  available: boolean;
  version: string;
  capabilities: string[];
  /** Why the CLI could not be started, when it is not available. */
  error?: string | null;
}
export interface Activity {
  id: string;
  kind: string;
  author: string;
  message: string;
  createdAt: number;
  data: Record<string, unknown>;
}
export interface RemoteItem {
  id: number;
  title: string;
  url: string;
  state: string;
  source: string;
  target: string;
}
export interface RemoteDetail {
  changes: { path: string; patch: string }[];
  checks: { name: string; status: string; url: string }[];
}
export interface RemoteConnection {
  provider: 'github' | 'gitlab';
  host: string;
  project: string;
  connected: boolean;
}

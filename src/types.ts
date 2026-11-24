export type StepStatus = 'pending' | 'in_progress' | 'blocked' | 'done';
export interface Step { id: string; title: string; status: StepStatus; note: string; author: string; updatedAt: number; }
export interface Plan { revision: number; objective: string; steps: Step[]; }
export interface Workspace { id: string; root: string; name: string; }
export interface Entry { name: string; path: string; directory: boolean; symlink: boolean; }
export interface OpenFile { path: string; content: string; savedContent: string; stamp: string; language: string; external?: boolean; }
export interface GitFile { path: string; index: string; worktree: string; }
export interface GitStatus { branch: string; files: GitFile[]; isRepo: boolean; }
export interface SearchHit { path: string; line: number; text: string; }
export interface Session { id: string; provider: 'codex' | 'claude'; title: string; path: string; modifiedAt: number; summary: string; parentId?: string; }
export interface Provider { id: string; available: boolean; version: string; capabilities: string[]; }
export interface Activity { id: string; kind: string; author: string; message: string; createdAt: number; data: Record<string, unknown>; }
export interface RemoteItem { id: number; title: string; url: string; state: string; source: string; target: string; }
export interface RemoteDetail { changes: { path: string; patch: string }[]; checks: { name: string; status: string; url: string }[]; }
export interface RemoteConnection { provider: 'github' | 'gitlab'; host: string; project: string; connected: boolean; }

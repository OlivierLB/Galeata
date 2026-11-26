import type { OpenFile } from './types.ts';
export interface FileDraft { path: string; content: string; stamp: string }
export function draftSnapshot(files: OpenFile[]): FileDraft[] {
  return files.filter(file => file.content !== file.savedContent)
    .map(({ path, content, stamp }) => ({ path, content, stamp }));
}
export function restoreDraft(file: OpenFile, drafts: FileDraft[]): OpenFile {
  const draft = drafts.find(draft => draft.path === file.path);
  return draft ? { ...file, content: draft.content, external: draft.stamp !== file.stamp } : file;
}
export function savedSnapshot(file: OpenFile, content: string, stamp: string): OpenFile {
  return { ...file, stamp, savedContent: content };
}

import { agentStore } from './agents/store.ts';
import { closeAgent, startAgent } from './agents/api.ts';
import type { Provider } from './agents/types.ts';

export interface SavedConversation {
  id: string; provider: Provider; sessionId?: string; draft: string;
  queue: string[]; mode?: string;
}
export interface ConversationLayout { active: string; right: string; split: boolean; pairs?: [string, string][] }
export interface EditorLayout {
  openFiles: string[]; activeFile: string; panel: string;
  splitFile?: string; pinnedFiles?: string[]; languages?: Record<string, string>;
  planVisible: boolean; bottomVisible: boolean; bottom: string;
  query?: string; fileSearchVisible?: boolean; diff?: { path: string; staged: boolean };
  sidebarWidth: number; planWidth: number; bottomHeight: number;
}
interface ProjectSession {
  version: 1;
  conversations?: SavedConversation[];
  conversationLayout?: ConversationLayout;
  editor?: EditorLayout;
  expanded?: string[];
}
const key = (id: string) => `galeata:project-session:${id}`;
export function readProjectSession(id: string): ProjectSession {
  try {
    const value = JSON.parse(localStorage.getItem(key(id)) ?? 'null');
    if (value?.version === 1 && typeof value === 'object') return value;
  } catch { /* An unavailable or damaged snapshot must not prevent opening a project. */ }
  return { version: 1 };
}
export function saveProjectSession(id: string, patch: Partial<ProjectSession>) {
  localStorage.setItem(key(id), JSON.stringify({ ...readProjectSession(id), ...patch, version: 1 }));
}

let stopPersistence: (() => void) | undefined;
/** Restore native sessions before mounting the workspace, so saved tab ids can be remapped. */
export async function restoreProjectConversations(id: string, onError: (error: unknown) => void) {
  stopPersistence?.();
  stopPersistence = undefined;
  const saved = readProjectSession(id);
  const old = agentStore.getAll();
  await Promise.allSettled(old.map(conversation => closeAgent(conversation.id)));
  agentStore.clear();
  const ids = new Map<string, string>();
  const failed: SavedConversation[] = [];
  const entries = Array.isArray(saved.conversations) ? saved.conversations : [];
  for (const entry of entries) {
    if (!entry || !['codex', 'claude'].includes(entry.provider) || typeof entry.id !== 'string') continue;
    try {
      const newId = await startAgent(entry.provider, typeof entry.sessionId === 'string' ? entry.sessionId : undefined, entry.mode);
      ids.set(entry.id, newId);
      agentStore.setDraft(newId, typeof entry.draft === 'string' ? entry.draft : '');
      agentStore.pauseQueue(newId, true);
      for (const text of Array.isArray(entry.queue) ? entry.queue : [])
        if (typeof text === 'string') agentStore.enqueue(newId, text);
      if (entry.sessionId && !agentStore.get(newId)?.sessionId) agentStore.apply(newId, [{ type: 'session', sessionId: entry.sessionId, model: null }]);
    } catch (error) { failed.push(entry); onError(`Reprise de ${entry.provider} impossible : ${String(error)}`); }
  }
  try {
    const names = JSON.parse(localStorage.getItem('galeata:conversation-names') ?? '{}');
    if (names && typeof names === 'object' && !Array.isArray(names)) {
      for (const [oldId, newId] of ids) if (typeof names[oldId] === 'string') names[newId] = names[oldId];
      localStorage.setItem('galeata:conversation-names', JSON.stringify(Object.fromEntries(Object.entries(names).slice(-200))));
    }
  } catch { /* Names are optional. */ }
  const layout = saved.conversationLayout;
  if (layout && typeof layout === 'object') {
    try {
      saveProjectSession(id, { conversationLayout: {
        active: ids.get(layout.active) ?? '', right: ids.get(layout.right) ?? '', split: layout.split === true,
        pairs: Array.isArray(layout.pairs) ? layout.pairs.flatMap(pair => {
          if (!Array.isArray(pair)) return [];
          const left = ids.get(pair[0]), right = ids.get(pair[1]);
          return left && right && left !== right ? [[left, right] as [string, string]] : [];
        }) : undefined,
      } });
    } catch (error) { onError(error); }
  }
  // Keep persistence outside React: typing does not re-render the conversation list.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    try {
      saveProjectSession(id, { conversations: agentStore.getAll().map<SavedConversation>(conversation => ({
        id: conversation.id, provider: conversation.provider, sessionId: conversation.sessionId,
        draft: agentStore.getDraft(conversation.id), mode: conversation.mode,
        queue: conversation.queuedMessages.map(message => message.text),
      })).concat(failed) });
    } catch (error) { onError(`Sauvegarde de la reprise impossible : ${String(error)}`); }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(flush, 400); };
  const unsubscribe = agentStore.subscribe(schedule);
  agentStore.onDraftChange = schedule;
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  stopPersistence = () => {
    flush(); unsubscribe(); agentStore.onDraftChange = undefined;
    window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', flush);
  };
  schedule();
}

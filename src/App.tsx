import EditorPreferencesPanel from './components/preferences/EditorPreferences.tsx';
import EditorStatus from './components/EditorStatus.tsx';
import { ChoicePicker } from './components/ChoicePicker.tsx';
import EditPreview from './components/EditPreview.tsx';
import { applyTextEdits, projectPath, globMatches, type ProposedFileEdit, type TextEdit } from './editorEdits.ts';
import { loadEditorConfig, normalizeSavedText } from './editorConfig.ts';
import { defaultEditorPreferences, readEditorPreferences, type EditorPreferences } from './editorPreferences.ts';
import { draftSnapshot, restoreDraft, savedSnapshot, type FileDraft } from './editorPersistence.ts';
import { Button, TextArea, TextInput } from './components/ui/Controls.tsx';
import ChecksDialog from './components/checks/ChecksDialog.tsx';
import ChecksStatusButton from './components/checks/ChecksStatusButton.tsx';
import { readProjectSession, saveProjectSession, restoreProjectConversations, type EditorLayout } from './projectSession.ts';
import { CountBadge } from './components/CountBadge.tsx';
import AgentCountBadge from './components/AgentCountBadge.tsx';
import PreferencesDialog from './components/preferences/PreferencesDialog.tsx';
import { applyTheme, readTheme, type Theme } from './theme.ts';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { desktop, getActiveWorkspace, openWorkspace, startupProject, request, subscribe } from './api.ts';
import { languageFor, languageExtensions } from './domain.ts';
import type {
  Activity,
  GitStatus,
  OpenFile,
  Plan,
  Provider,
  SearchHit,
  Session,
  Step,
  Workspace,
} from './types.ts';
import { Icon } from './components/Icon.tsx';
import { FileTree } from './components/FileTree.tsx';
import PlanPanel from './components/PlanPanel.tsx';
import ActivityFeed from './components/ActivityFeed.tsx';
import Dialog, { type DialogSpec } from './components/Dialog.tsx';
import type { TerminalLaunch } from './components/TerminalView.tsx';
import Splitter, { usePanelSize } from './components/Splitter.tsx';
import AgentWorkspace from './components/AgentWorkspace.tsx';
import { FilesHome, FileSearch, GitOverview } from './components/WorkspacePages.tsx';
import ToolConfiguration from './components/ToolConfiguration.tsx';
import GitManager, { GitToolbar, type GitTab } from './components/GitManager.tsx';
import { sendToAgent } from './agents/api.ts';
import { agentStore } from './agents/store.ts';
import { mascot } from './mascot/store.ts';
import TurtleMascot from './components/TurtleMascot.tsx';
import { type Provider as AgentProvider } from './agents/types.ts';
import {
  readDefaultAgent,
  writeDefaultAgent,
} from './agents/preferences.ts';

const EditorSurface = lazy(() =>
  import('./components/EditorSurface.tsx').catch(() => import('./components/SimpleEditor.tsx')),
);
const TerminalView = lazy(() => import('./components/TerminalView.tsx'));
const initialPlan: Plan = { revision: 0, objective: '', steps: [] };
// Resizable panels. Absolute bounds here; the editor keeps a minimum share at drag time.
const wide = typeof window !== 'undefined' && window.innerWidth >= 1650;
const sidebarBounds = { min: 180, max: 640 };
const planBounds = { min: 240, max: 720 };
const bottomBounds = { min: 90, max: 1200 };
const sidebarDefault = wide ? 270 : 245;
const planDefault = wide ? 345 : 315;
const bottomDefault = 220;
const editorMinWidth = 360; // the agent conversation keeps at least this width
const editorMinHeight = 120;
type Panel = 'files' | 'git' | 'agents' | 'tools';
type Bottom = 'terminal' | 'activity' | 'checks';
interface TerminalTab {
  launch: TerminalLaunch;
  id?: string;
  exited?: boolean;
}
const panelNames: Record<Panel, string> = {
  files: 'Explorateur',
  git: 'Contrôle de source',
  agents: 'Agents & sessions',
  tools: 'Outils IA',
};
const navigation: { id: Panel; icon: string; label: string }[] = [
  { id: 'files', icon: 'files', label: 'Fichiers' },
  { id: 'git', icon: 'git', label: 'Git' },
  { id: 'agents', icon: 'agents', label: 'Agents et sessions' },
  { id: 'tools', icon: 'settings', label: 'Outils IA' },
];

export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [panel, setPanel] = useState<Panel>('agents');
  const [toolsVisited, setToolsVisited] = useState(false);
  const [mascotAgent, setMascotAgent] = useState('');
  const planConversation = useRef(mascotAgent);
  planConversation.current = mascotAgent;
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const previousPlan = useRef({ workspaceId: workspace?.id, plan: initialPlan });
  useEffect(() => {
    const { plan: previous, workspaceId } = previousPlan.current;
    previousPlan.current = { workspaceId: workspace?.id, plan };
    if (workspaceId !== workspace?.id || !previous.revision || plan.revision <= previous.revision || plan.objective !== previous.objective) return;
    const completed = plan.steps.some((step) => step.status === 'done'
      && previous.steps.some((old) => old.id === step.id && old.status !== 'done'));
    if (completed) mascot.react(plan.steps.every((step) => step.status === 'done') ? 'plan-completed' : 'step-completed');
  }, [plan, workspace?.id]);
  const [git, setGit] = useState<GitStatus>({ branch: '', isRepo: false, files: [] });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tabs, setTabs] = useState<OpenFile[]>([]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [active, setActive] = useState('');
  const [line, setLine] = useState<number>();
  const [column, setColumn] = useState<number>();
  const [revealRequest, setRevealRequest] = useState(0);
  const [diff, setDiff] = useState<{
    path: string;
    original: string;
    modified: string;
    staged: boolean;
    /** The right side is the working file itself: edits go to its tab and are saved to disk. */
    editable: boolean;
  } | null>(null);
  const [treeRevision, setTreeRevision] = useState(0);
  const planVisible = panel === 'agents';
  const [bottomVisible, setBottomVisible] = useState(
    () => localStorage.getItem('galeata:bottom-visible') === 'true',
  );
  // Code is secondary: a right-hand panel opened on demand (file, diff, agent request).
  const [defaultAgent, setDefaultAgent] = useState<AgentProvider>(readDefaultAgent);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferencesSection, setPreferencesSection] = useState<'general' | 'editor'>('general');
  const [checksOpen, setChecksOpen] = useState(false);
  const layoutRef = useRef<HTMLElement>(null);
  const centralRef = useRef<HTMLElement>(null);
  const [sidebarWidth, setSidebarWidth] = usePanelSize(
    'galeata:sidebar-width',
    sidebarDefault,
    sidebarBounds,
  );
  const [planWidth, setPlanWidth] = usePanelSize('galeata:plan-width', planDefault, planBounds);
  const [bottomHeight, setBottomHeight] = usePanelSize(
    'galeata:bottom-height',
    bottomDefault,
    bottomBounds,
  );
  // Space left for a side panel once the conversation keeps its minimum width.
  const sideRoom = (other: number) =>
    (layoutRef.current?.clientWidth ?? Infinity) - 76 - other - editorMinWidth;
  const planShown = planVisible && !!workspace;
  const reviewing = panel === 'git' && !!workspace;
  const filesPage = panel === 'files' && !!workspace;
  const agentPage = panel === 'agents';
  function navigate(next: Panel) {
    if (next === 'tools') setToolsVisited(true);
    if (next === 'files') setDiff(null);
    setPanel(next);
  }
  const [bottom, setBottom] = useState<Bottom>('terminal');
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const [terminalKey, setTerminalKey] = useState('');
  const [toast, setToast] = useState('');
  const [autoSave, setAutoSave] = useState(true);
  const autoSaveRef = useRef(autoSave); autoSaveRef.current = autoSave;
  const [editorPreferences, setEditorPreferences] = useState<EditorPreferences>(defaultEditorPreferences);
  const [splitFile, setSplitFile] = useState('');
  const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);
  useEffect(() => {
    if (workspace) setEditorPreferences(readEditorPreferences(workspace.id));
    const saved = workspace ? readProjectSession(workspace.id).editor : undefined;
    setSplitFile(saved?.splitFile ?? ''); setPinnedFiles(saved?.pinnedFiles ?? []);
  }, [workspace?.id]);
  const [editorPreferenceError, setEditorPreferenceError] = useState('');
  function updateEditorPreferences(patch: Partial<EditorPreferences>) {
    const next = { ...editorPreferences, ...patch };
    try {
      if (workspace) localStorage.setItem(`galeata:editor-preferences:${workspace.id}`, JSON.stringify(next));
      setEditorPreferences(next); setEditorPreferenceError(''); return true;
    } catch { setEditorPreferenceError('Impossible d’enregistrer ces réglages. Libérez de l’espace et réessayez.'); return false; }
  }
  function updateAutoSave(enabled: boolean) {
    try {
      if (workspace) localStorage.setItem(`galeata:autosave:${workspace.id}`, String(enabled));
      setAutoSave(enabled); setEditorPreferenceError(''); return true;
    } catch { setEditorPreferenceError('Impossible d’enregistrer le mode de sauvegarde.'); return false; }
  }
  function openEditorPreferences() { setPreferencesSection('editor'); setPreferencesOpen(true); }


  const [editorReady, setEditorReady] = useState(false);
  const orphanDrafts = useRef<FileDraft[]>([]);
  const [saveStates, setSaveStates] = useState<Record<string, 'saving' | 'error' | undefined>>({});
  const [draftError, setDraftError] = useState('');
  const [persistedDrafts, setPersistedDrafts] = useState<Record<string, string>>({});
  const [languageInfo, setLanguageInfo] = useState<Record<string, string>>({});
  useEffect(() => {
    const listener = (event: Event) => { const detail = (event as CustomEvent<{ language: string; message: string }>).detail; setLanguageInfo(previous => ({ ...previous, [detail.language]: detail.message })); };
    window.addEventListener('galeata:language-info', listener);
    return () => window.removeEventListener('galeata:language-info', listener);
  }, []);
  useEffect(() => {
    const listener = (event: Event) => setToast((event as CustomEvent<string>).detail);
    window.addEventListener('galeata:language-status', listener);
    return () => window.removeEventListener('galeata:language-status', listener);
  }, []);
  const pendingSaves = useRef(new Map<string, Promise<void>>());
  const failedSaves = useRef(new Map<string, string>());

  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [editPreview, setEditPreview] = useState<{ title: string; files: ProposedFileEdit[]; workspaceId: string } | null>(null);
  const [symbols, setSymbols] = useState<{ name: string; path: string; line: number }[]>([]);
  const symbolSearch = useRef<((query: string) => Promise<typeof symbols>) | null>(null);
  const [symbolVisible, setSymbolVisible] = useState(false);
  const codeHistory = useRef<{ path: string; line?: number; column?: number }[]>([]);
  const navigationIndex = useRef(-1);
  const navigating = useRef(false);
  const [query, setQuery] = useState('');
  const [fileSearchVisible, setFileSearchVisible] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchNext, setSearchNext] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const searchKey = `${workspace?.id}:${query}`;
  const searchKeyRef = useRef(searchKey);
  searchKeyRef.current = searchKey;
  function openProjectSearch() {
    setPalette(false);
    setPanel('files'); setDiff(null); setFileSearchVisible(true);
    requestAnimationFrame(() => document.getElementById('project-content-search')?.focus());
  }
  const [commitMessage, setCommitMessage] = useState('');
  const [gitManager, setGitManager] = useState<GitTab | null>(null);
  const gitRunning = useRef(false);
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteHits, setPaletteHits] = useState<SearchHit[]>([]);
  const activeFile = tabs.find((file) => file.path === active);
  const error = useCallback(
    (value: unknown) => setToast(String(value).replace(/^Error: /, '')),
    [],
  );

  const refresh = useCallback(async () => {
    const expected = getActiveWorkspace()?.id;
    const conversationId = planConversation.current;
    if (!expected) return;
    const results = await Promise.allSettled([
      request<Plan>('plan.get', { conversationId: conversationId || 'empty' }),
      request<GitStatus>('git.status'),
      request<Activity[]>('activity.list'),
    ]);
    if (getActiveWorkspace()?.id !== expected) return;
    const [p, g, a] = results;
    if (p.status === 'fulfilled') { if (planConversation.current === conversationId) setPlan(p.value); }
    else error(p.reason);
    if (g.status === 'fulfilled') setGit(g.value);
    else error(g.reason);
    if (a.status === 'fulfilled') setActivities(a.value);
    else error(a.reason);
  }, [error]);

  const loadSessions = useCallback(async () => {
    const expected = getActiveWorkspace()?.id;
    const results = await Promise.allSettled([
      request<Session[]>('sessions.list'),
      request<Provider[]>('providers.list'),
    ]);
    if (getActiveWorkspace()?.id !== expected) return;
    if (results[0].status === 'fulfilled') setSessions(results[0].value);
    else error(results[0].reason);
    if (results[1].status === 'fulfilled') setProviders(results[1].value);
    else error(results[1].reason);
  }, [error]);

  const openFile = useCallback(
    async (path: string, targetLine?: number, reveal = true, targetColumn?: number) => {
      if (!navigating.current) {
        const last = codeHistory.current[navigationIndex.current];
        if (!last || last.path !== path || last.line !== targetLine) {
          codeHistory.current = [...codeHistory.current.slice(0, navigationIndex.current + 1), { path, line: targetLine, column: targetColumn }].slice(-100);
          navigationIndex.current = codeHistory.current.length - 1;
        }
      }
      setDiff(null);
      setLine(targetLine); setColumn(targetColumn);
      setRevealRequest(value => value + 1);
      if (reveal) { setPanel('files'); mascot.react('file-opened'); }
      if (tabsRef.current.some((file) => file.path === path)) {
        setActive(path);
        return;
      }
      const expected = getActiveWorkspace()?.id;
      try {
        const result = await request<{ content: string; stamp: string }>('workspace.read', {
          path,
        });
        if (getActiveWorkspace()?.id !== expected) return;
        let recovered: FileDraft[] = [];
        try { const value = JSON.parse(localStorage.getItem(`galeata:file-drafts:${expected}`) ?? '[]'); if (Array.isArray(value)) recovered = value.filter(item => typeof item?.path === 'string' && typeof item?.content === 'string' && typeof item?.stamp === 'string'); } catch { /* Optional recovery. */ }
        orphanDrafts.current = orphanDrafts.current.filter(draft => draft.path !== path);
        const association = expected ? readProjectSession(expected).editor?.languages?.[path] : undefined;
        setTabs((previous) =>
          previous.some((file) => file.path === path)
            ? previous
            : [
                ...previous,
                {
                  ...restoreDraft({ path, content: result.content, savedContent: result.content, stamp: result.stamp, language: association && languageExtensions[association] ? association : languageFor(path, result.content) }, recovered),
                },
              ],
        );
        setActive(path);
      } catch (e) {
        error(e);
      }
    },
    [error],
  );

  function navigateCode(direction: number) {
    const index = navigationIndex.current + direction;
    const target = codeHistory.current[index];
    if (!target) return;
    navigationIndex.current = index; navigating.current = true;
    void openFile(target.path, target.line, true, target.column).finally(() => { navigating.current = false; });
  }
  async function proposeWorkspaceEdit(title: string, edit: { changes?: Record<string, TextEdit[]>; documentChanges?: { textDocument?: { uri: string }; edits?: TextEdit[]; kind?: string }[]; _galeataStamps?: Record<string, string> }, snapshots: Record<string, string> = {}) {
    const expected = getActiveWorkspace();
    if (!expected) return;
    await Promise.allSettled([...pendingSaves.current.values()]);
    const grouped = new Map<string, TextEdit[]>();
    for (const [uri, changes] of Object.entries(edit.changes ?? {})) grouped.set(projectPath(uri, expected.root), changes);
    for (const change of edit.documentChanges ?? []) {
      if (change.kind || !change.textDocument || !change.edits) throw new Error('Cette action contient une opération de fichier non prise en charge.');
      const path = projectPath(change.textDocument.uri, expected.root);
      grouped.set(path, [...(grouped.get(path) ?? []), ...change.edits]);
    }
    if (grouped.size > 100) throw new Error('Limite de 100 fichiers par aperçu.');
    const files: ProposedFileEdit[] = [];
    let size = 0;
    for (const [path, edits] of grouped) {
      const disk = await request<{ content: string; stamp: string }>('workspace.read', { path });
      const tab = tabsRef.current.find(file => file.path === path);
      if (tab?.external || (tab && tab.stamp !== disk.stamp)) throw new Error(`Le fichier ${path} a changé sur disque.`);
      const before = tab?.content ?? disk.content;
      if (snapshots[path] !== undefined && snapshots[path] !== before) throw new Error(`${path} a changé pendant la préparation des changements.`);
      const sourceStamp = Object.entries(edit._galeataStamps ?? {}).find(([uri]) => projectPath(uri, expected.root) === path)?.[1];
      if (sourceStamp && sourceStamp !== disk.stamp) throw new Error(`${path} a changé depuis la réponse du serveur.`);
      const after = applyTextEdits(before, edits);
      size += before.length + after.length;
      if (size > 8 * 1024 * 1024) throw new Error('Aperçu trop volumineux.');
      if (before !== after) files.push({ path, before, after, stamp: disk.stamp });
    }
    if (getActiveWorkspace()?.id !== expected.id) return;
    if (!files.length) { setToast('Aucun changement à appliquer.'); return; }
    setEditPreview({ title, files, workspaceId: expected.id });
  }
  async function applyProposedEdits(files: ProposedFileEdit[]) {
    if (!editPreview || getActiveWorkspace()?.id !== editPreview.workspaceId) throw new Error('Le projet a changé.');
    const expected = editPreview.workspaceId;
    const editor = await import('./components/EditorSurface.tsx');
    if (getActiveWorkspace()?.id !== expected) throw new Error('Le projet a changé.');
    const disks = await Promise.all(files.map(file => request<{ content: string; stamp: string }>('workspace.read', { path: file.path })));
    if (getActiveWorkspace()?.id !== expected) throw new Error('Le projet a changé.');
    for (let index = 0; index < files.length; index++) {
      const file = files[index], disk = disks[index];
      const current = tabsRef.current.find(tab => tab.path === file.path);
      if (disk.stamp !== file.stamp || (current?.content ?? disk.content) !== file.before)
        throw new Error(`${file.path} a changé depuis l’aperçu. Recommencez l’action.`);
    }
    const next = [...tabsRef.current];
    files.forEach((file, index) => {
      const at = next.findIndex(tab => tab.path === file.path);
      const updated = { path: file.path, content: file.after, savedContent: disks[index].content, stamp: file.stamp, language: languageFor(file.path, file.after) };
      if (at >= 0) next[at] = { ...next[at], content: file.after }; else next.push(updated);
    });
    editor.applyFileChanges(expected, getActiveWorkspace()!.root, files);
    tabsRef.current = next; setTabs(next);
  }
  async function previewReplacement(query: string, replacement: string, include: string, exclude: string) {
    const expected = getActiveWorkspace()?.id;
    if (!expected || !query) return;
    await Promise.allSettled([...pendingSaves.current.values()]);
    const paths = new Set(tabsRef.current.filter(file => file.content.includes(query)).map(file => file.path));
    let offset: number | null = 0;
    while (offset !== null) {
      const page: { items: SearchHit[]; nextOffset: number | null } = await request('workspace.search_text', { query, offset });
      page.items.forEach(hit => paths.add(hit.path));
      offset = page.nextOffset;
      if (offset !== null && offset > 10000) throw new Error('Trop de résultats : précisez la recherche.');
      if (getActiveWorkspace()?.id !== expected) return;
    }
    const patterns = (value: string) => value.split(';').map(pattern => pattern.trim()).filter(Boolean);
    const includes = patterns(include), excludes = patterns(exclude);
    const files: ProposedFileEdit[] = [];
    let size = 0;
    for (const path of paths) {
      if ((includes.length && !includes.some(pattern => globMatches(path, pattern))) || excludes.some(pattern => globMatches(path, pattern))) continue;
      const disk = await request<{ content: string; stamp: string }>('workspace.read', { path });
      const tab = tabsRef.current.find(file => file.path === path);
      if (tab?.external || (tab && tab.stamp !== disk.stamp)) throw new Error(`${path} a changé sur disque.`);
      const before = tab?.content ?? disk.content, after = before.split(query).join(replacement);
      size += before.length + after.length;
      if (files.length >= 100 || size > 8 * 1024 * 1024) throw new Error('Remplacement trop volumineux : précisez les filtres.');
      if (before !== after) files.push({ path, before, after, stamp: disk.stamp });
    }
    if (getActiveWorkspace()?.id !== expected) return;
    if (files.length) setEditPreview({ title: 'Remplacer dans le projet', files, workspaceId: expected });
    else setToast('Aucun changement dans les fichiers sélectionnés.');
  }
  useEffect(() => {
    const edit = (event: Event) => {
      const detail = (event as CustomEvent<{ title: string; edit: Parameters<typeof proposeWorkspaceEdit>[1]; snapshots?: Record<string, string> }>).detail;
      void proposeWorkspaceEdit(detail.title, detail.edit, detail.snapshots).catch(error);
    };
    const structure = (event: Event) => { symbolSearch.current = null; setSymbols((event as CustomEvent<typeof symbols>).detail); setSymbolVisible(true); setPaletteQuery(''); setPalette(true); };
    const cursor = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; line: number; column: number }>).detail;
      const current = codeHistory.current[navigationIndex.current];
      if (current?.path === detail.path) { current.line = detail.line; current.column = detail.column; }
    };
    const keys = (event: KeyboardEvent) => {
      if (event.altKey && ['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); navigateCode(event.key === 'ArrowLeft' ? -1 : 1); }
    };
    const querySymbols = (event: Event) => {
      const search = (event as CustomEvent<(query: string) => Promise<typeof symbols>>).detail;
      symbolSearch.current = search; setSymbols([]); setSymbolVisible(true); setPaletteQuery(''); setPalette(true);
    };
    const codeActions = (event: Event) => {
      const detail = (event as CustomEvent<{ actions: { title: string }[]; apply: (index: number) => Promise<void> }>).detail;
      if (!detail.actions.length) { setToast('Aucune correction proposée pour cette sélection.'); return; }
      setDialog({ title: 'Choisir une correction', fields: [{ name: 'action', label: 'Correction', options: detail.actions.map((action, index) => ({ value: String(index), label: action.title })) }], submit: 'Voir les changements', onSubmit: async values => detail.apply(Number(values.action)) });
    };
    window.addEventListener('galeata:cursor-position', cursor);
    window.addEventListener('galeata:query-symbols', querySymbols);
    window.addEventListener('galeata:code-action-choices', codeActions);
    window.addEventListener('galeata:workspace-edit', edit);
    window.addEventListener('galeata:symbols', structure);
    window.addEventListener('keydown', keys);
    return () => { window.removeEventListener('galeata:cursor-position', cursor); window.removeEventListener('galeata:query-symbols', querySymbols); window.removeEventListener('galeata:code-action-choices', codeActions); window.removeEventListener('galeata:workspace-edit', edit); window.removeEventListener('galeata:symbols', structure); window.removeEventListener('keydown', keys); };
  });

  const showDiff = useCallback(
    async (path: string, staged = false) => {
      const expected = getActiveWorkspace()?.id;
      try {
        const result = await request<{ original: string; modified: string }>('git.diff', {
          path,
          staged,
        });
        if (getActiveWorkspace()?.id !== expected) return;
        // Unstaged changes are the working file: open it so the diff can be edited and saved.
        let editable = false;
        if (!staged) {
          if (!tabsRef.current.some((file) => file.path === path)) {
            const file = await request<{ content: string; stamp: string }>('workspace.read', {
              path,
            }).catch(() => null);
            if (file && getActiveWorkspace()?.id === expected)
              setTabs((previous) =>
                previous.some((tab) => tab.path === path)
                  ? previous
                  : [
                      ...previous,
                      {
                        path,
                        content: file.content,
                        savedContent: file.content,
                        stamp: file.stamp,
                        language: languageFor(path),
                      },
                    ],
              );
            editable = !!file;
          } else editable = true;
          if (editable) setActive(path);
        }
        setDiff({ path, ...result, staged, editable });
        setPanel('git');
      } catch (e) {
        error(e);
      }
    },
    [error],
  );

  const chooseWorkspace = useCallback(
    async (path?: string) => {
      if (getActiveWorkspace()) {
        try {
          localStorage.setItem(`galeata:file-drafts:${getActiveWorkspace()!.id}`, JSON.stringify(
            [...orphanDrafts.current, ...draftSnapshot(tabsRef.current)]));
        } catch (e) { error(e); return; }
      }
      setEditorReady(false);
      setBusy('Ouverture du projet…');
      try {
        const result = await openWorkspace(path);
        if (!result) { setEditorReady(true); return; }
        codeHistory.current = []; navigationIndex.current = -1; setSymbols([]); setSymbolVisible(false); setEditPreview(null);
        setTabs([]);
        setActive('');
        setDiff(null);
        setSessions([]);
        setProviders([]);
        setActivities([]);
        setPlan(initialPlan);
        setTerminals([]);
        setHits([]);
        setTreeRevision((value) => value + 1);
        await refresh();
        void loadSessions();
        const saved = readProjectSession(result.id).editor;
        const legacy = saved ? null : await request<{ openFiles?: string[]; activeFile?: string } | null>('preferences.get');
        const paths = saved?.openFiles ?? legacy?.openFiles ?? (!desktop ? ['README.md'] : []);
        let drafts: { path: string; content: string; stamp: string }[] = [];
        try {
          const value = JSON.parse(localStorage.getItem(`galeata:file-drafts:${result.id}`) ?? '[]');
          if (Array.isArray(value)) drafts = value.filter(item => typeof item?.path === 'string' && typeof item?.content === 'string' && typeof item?.stamp === 'string');
        } catch { /* A corrupt draft must not prevent opening the project. */ }
        orphanDrafts.current = [];
        const restored: OpenFile[] = [];
        if (Array.isArray(paths)) for (const path of new Set([...paths, ...drafts.map(draft => draft.path)])) {
          if (typeof path !== 'string') continue;
          try {
            const file = await request<{ content: string; stamp: string }>('workspace.read', { path });
            restored.push(restoreDraft({ path, content: file.content, savedContent: file.content,
              stamp: file.stamp, language: saved?.languages?.[path] && languageExtensions[saved.languages[path]] ? saved.languages[path] : languageFor(path, file.content) }, drafts));
          } catch (e) {
            const draft = drafts.find(draft => draft.path === path);
            if (draft) orphanDrafts.current.push(draft);
            error(e);
          }
        }
        setTabs(restored);
        const selected = saved?.activeFile ?? legacy?.activeFile;
        setActive(restored.some(file => file.path === selected) ? selected! : restored.at(-1)?.path ?? '');
        if (saved) {
          setPanel(saved.panel === 'search' ? 'files' : ['agents', 'files', 'git'].includes(saved.panel) ? saved.panel as Panel : 'agents');
          setFileSearchVisible(saved.fileSearchVisible === true || saved.panel === 'search');
          setBottomVisible(saved.bottomVisible === true);
          if (['terminal', 'activity', 'checks'].includes(saved.bottom)) setBottom(saved.bottom as Bottom);
          setQuery(typeof saved.query === 'string' ? saved.query : '');
          if (saved.diff && typeof saved.diff.path === 'string') await showDiff(saved.diff.path, saved.diff.staged === true);
          setSidebarWidth(saved.sidebarWidth);
          setPlanWidth(saved.planWidth); setBottomHeight(saved.bottomHeight);
        }
        await restoreProjectConversations(result.id, error);
        setWorkspace(result);
        setEditorReady(true);
      } catch (e) {
        error(e);
      } finally {
        setBusy('');
      }
    },
    [error, refresh, loadSessions, showDiff, setSidebarWidth, setPlanWidth, setBottomHeight],
  );

  useEffect(() => {
    void startupProject().then((path) => { if (path) void chooseWorkspace(path); }).catch(error);
    // Startup arguments belong to this instance and are consumed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPreferences() {
    setPreferencesSection('general'); setPreferencesOpen(true);
  }

  function openFolder() {
    void chooseWorkspace();
  }

  useEffect(() => {
    if (!desktop) void chooseWorkspace();
  }, [chooseWorkspace]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 10000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    localStorage.setItem('galeata:plan-visible', String(planVisible));
  }, [planVisible]);
  useEffect(() => {
    localStorage.setItem('galeata:bottom-visible', String(bottomVisible));
  }, [bottomVisible]);
  const layoutSnapshot = useRef<{ id: string; editor: EditorLayout } | null>(null);
  layoutSnapshot.current = workspace ? { id: workspace.id, editor: {
    openFiles: tabs.map(file => file.path), activeFile: active, panel, splitFile, pinnedFiles, languages: Object.fromEntries(tabs.map(file => [file.path, file.language])),
    planVisible, bottomVisible, bottom, query, fileSearchVisible,
    diff: diff ? { path: diff.path, staged: diff.staged } : undefined,
    sidebarWidth, planWidth, bottomHeight,
  } } : null;
  useEffect(() => {
    const flush = () => {
      const snapshot = layoutSnapshot.current;
      if (!snapshot) return;
      try { saveProjectSession(snapshot.id, { editor: snapshot.editor }); } catch (e) { error(e); }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('beforeunload', flush); window.removeEventListener('pagehide', flush); };
  }, [error]);
  useEffect(() => {
    if (!workspace) return;
    const timer = setTimeout(() => {
      const snapshot = layoutSnapshot.current;
      if (snapshot) try { saveProjectSession(snapshot.id, { editor: snapshot.editor }); } catch (e) { error(e); }
    }, 400);
    return () => clearTimeout(timer);
  }, [workspace, tabs, active, panel, planVisible, bottomVisible, bottom,
    sidebarWidth, planWidth, bottomHeight, query, fileSearchVisible, diff, splitFile, pinnedFiles, error]);

  useEffect(() => {
    if (!workspace) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const register = async <T,>(event: string, handler: (event: T) => void) => {
      const clean = await subscribe<T>(event, handler);
      if (disposed) clean();
      else cleanups.push(clean);
    };
    const changed = (event: { workspaceId: string }) => {
      if (event.workspaceId !== workspace.id) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
        setTreeRevision((value) => value + 1);
      }, 300);
    };
    void register('workspace:changed', changed).catch(error);
    // Plan/activity events do not change files: avoid Git and directory rescans.
    const planChanged = (event: { workspaceId: string }) => {
      if (event.workspaceId !== workspace.id) return;
      void request<Plan>('plan.get', { conversationId: mascotAgent || 'empty' }).then(value => {
        if (!disposed && planConversation.current === mascotAgent) setPlan(value);
      }).catch(error);
    };
    const activityChanged = (event: { workspaceId: string }) => {
      if (event.workspaceId !== workspace.id) return;
      void request<Activity[]>('activity.list').then(value => {
        if (!disposed) setActivities(value);
      }).catch(error);
    };
    void register('plan:changed', planChanged).catch(error);
    void register('activity:changed', activityChanged).catch(error);
    void register<{
      workspaceId: string;
      method: string;
      args: { path: string; line?: number; staged?: boolean };
    }>('ui:request', (event) => {
      if (event.workspaceId !== workspace.id) return;
      if (event.method === 'ui.show_diff') void showDiff(event.args.path, event.args.staged);
      else void openFile(event.args.path, event.args.line);
    }).catch(error);
    return () => {
      disposed = true;
      clearTimeout(timer);
      cleanups.forEach((clean) => clean());
    };
  }, [workspace, refresh, error, showDiff, openFile, mascotAgent]);

  useEffect(() => {
    if (!workspace || !active) return;
    let disposed = false;
    let reading = false;
    async function check() {
      if (reading) return;
      const previous = tabsRef.current.find((file) => file.path === active);
      if (!previous) return;
      reading = true;
      try {
        const result = await request<{ content: string; stamp: string }>('workspace.read', {
          path: active,
        });
        if (disposed || result.stamp === previous.stamp) return;
        mascot.react('file-changed');
        setTabs((files) =>
          files.map((file) =>
            file.path !== active
              ? file
              : file.content !== file.savedContent
                ? { ...file, external: true }
                : {
                    ...file,
                    content: result.content,
                    savedContent: result.content,
                    stamp: result.stamp,
                    external: false,
                  },
          ),
        );
      } catch {
        /* The user sees missing-file errors when opening or saving. */
      } finally {
        reading = false;
      }
    }
    void check();
    const interval = setInterval(() => {
      if (!document.hidden) void check();
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [workspace, active, treeRevision]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('galeata:open-models', {
      detail: tabs.map(file => `${workspace?.id}:${file.path}`),
    }));
  }, [tabs, workspace?.id]);
  async function saveFile(path: string, automatic = false): Promise<void> {
    if (!desktop) return;
    const workspaceId = getActiveWorkspace()?.id;
    if (!workspaceId || workspaceId !== workspace?.id) return;
    const key = `${workspaceId}:${path}`;
    const pending = pendingSaves.current.get(key);
    if (pending) { await pending; return saveFile(path, automatic); }
    let file = tabsRef.current.find(file => file.path === path);
    if (!file || file.content === file.savedContent) return;
    if (file.external) throw new Error('Comparez ou rechargez le fichier avant de l’enregistrer.');
    let retry = false;
    const operation = (async () => {
      setSaveStates(previous => ({ ...previous, [key]: 'saving' }));
      try {
        const snapshot = file!;
        let content = snapshot.content;
        if (editorPreferences.formatOnSave) {
          const editor = await import('./components/EditorSurface.tsx');
          content = await editor.formatOpenFile(key, content, snapshot, workspace!.root, editorPreferences);
        }
        const config = desktop ? await loadEditorConfig(path, async relative => (await request<{ content: string }>('workspace.read', { path: relative })).content) : {};
        content = normalizeSavedText(content, config);
        if (getActiveWorkspace()?.id !== workspaceId) throw new Error('Le projet a changé pendant l’enregistrement.');
        const latest = tabsRef.current.find(current => current.path === path);
        if (latest?.external) throw new Error('Le fichier a changé sur disque : comparez les versions avant d’enregistrer.');
        if (!latest) return;
        if (latest.content !== snapshot.content || latest.stamp !== snapshot.stamp) { retry = true; return; }
        if (content !== snapshot.content) {
          const editor = await import('./components/EditorSurface.tsx');
          if (getActiveWorkspace()?.id !== workspaceId) throw new Error('Le projet a changé pendant l’enregistrement.');
          const current = tabsRef.current.find(file => file.path === path);
          if (!current || current.content !== snapshot.content || current.stamp !== snapshot.stamp || current.external) { retry = true; return; }
          editor.applyFileChanges(workspaceId, workspace!.root, [{ path, before: snapshot.content, after: content }]);
          tabsRef.current = tabsRef.current.map(current => current.path === path ? { ...current, content } : current);
          setTabs(previous => previous.map(current => current.path === path ? { ...current, content } : current));
        }
        file = { ...snapshot, content };
        const result = await request<{ stamp: string }>('workspace.write', {
          path, content, stamp: snapshot.stamp,
        });
        if (getActiveWorkspace()?.id !== workspaceId) return;
        tabsRef.current = tabsRef.current.map(current => current.path === path
          ? savedSnapshot(current, content, result.stamp) : current);
        setTabs(previous => previous.map(current => current.path === path
          ? savedSnapshot(current, content, result.stamp) : current));
        failedSaves.current.delete(key);
        setSaveStates(previous => ({ ...previous, [key]: undefined }));
      } catch (e) {
        failedSaves.current.set(key, file.content);
        if (getActiveWorkspace()?.id === workspaceId) {
          setSaveStates(previous => ({ ...previous, [key]: 'error' }));
          error(e);
        }
        throw e;
      } finally {
        setSaveStates(previous => previous[key] === 'saving' ? { ...previous, [key]: undefined } : previous);
      }
    })();
    pendingSaves.current.set(key, operation);
    try { await operation; } finally { pendingSaves.current.delete(key); }
    if (retry && (!automatic || autoSaveRef.current)) return saveFile(path, automatic);
  }
  useEffect(() => {
    setSaveStates({}); setPersistedDrafts({}); setDraftError(''); setEditorPreferenceError('');
    if (!workspace) return;
    try { setAutoSave(localStorage.getItem(`galeata:autosave:${workspace.id}`) !== 'false'); }
    catch { setAutoSave(true); }
  }, [workspace?.id]);
  useEffect(() => {
    if (!workspace || !editorReady || getActiveWorkspace()?.id !== workspace.id) return;
    const flush = () => {
      try {
        localStorage.setItem(`galeata:file-drafts:${workspace.id}`, JSON.stringify(
          [...orphanDrafts.current, ...draftSnapshot(tabs)]));
        setPersistedDrafts(Object.fromEntries(tabs.filter(file => file.content !== file.savedContent).map(file => [file.path, file.content])));
        setDraftError('');
      } catch { setDraftError('Le brouillon local n’a pas pu être conservé.'); }
    };
    const timer = setTimeout(flush, 300);
    window.addEventListener('pagehide', flush);
    return () => { clearTimeout(timer); window.removeEventListener('pagehide', flush); };
  }, [tabs, workspace?.id, editorReady]);
  useEffect(() => {
    if (!desktop || !workspace || !autoSave || !editorReady || editPreview) return;
    const timer = setTimeout(() => {
      for (const file of tabsRef.current) {
        const key = `${workspace.id}:${file.path}`;
        if (!file.external && file.content !== file.savedContent
          && failedSaves.current.get(key) !== file.content)
          void saveFile(file.path, true).catch(() => {});
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [tabs, autoSave, workspace?.id, editorReady, editPreview]);
  function removeTab(path: string) {
    setTabs((previous) => previous.filter((file) => file.path !== path));
    if (active === path) setActive(tabs.find((file) => file.path !== path)?.path ?? '');
  }
  function closeTab(path: string) {
    const file = tabs.find((file) => file.path === path);
    if (file && file.content !== file.savedContent)
      setDialog({
        title: 'Fermer le fichier',
        description: `Des modifications de ${path} ne sont pas enregistrées.`,
        fields: [
          {
            name: 'action',
            label: 'Action',
            options: [
              { value: 'save', label: 'Enregistrer puis fermer' },
              { value: 'discard', label: 'Abandonner les modifications' },
            ],
          },
        ],
        submit: 'Fermer le fichier',
        onSubmit: async (values) => {
          if (values.action === 'save') await saveFile(path);
          removeTab(path);
        },
      });
    else removeTab(path);
  }
  useEffect(() => {
    let disposed = false;
    setPlan(initialPlan);
    void request<Plan>('plan.get', { conversationId: mascotAgent || 'empty' }).then(value => { if (!disposed && planConversation.current === mascotAgent) setPlan(value); }).catch(error);
    return () => { disposed = true; };
  }, [mascotAgent, workspace?.id, error]);

  async function savePlan(next: Plan) {
    try {
      const result = await request<Plan>('plan.save', { revision: next.revision, plan: next, conversationId: mascotAgent || 'empty' });
      setPlan(result);
      await refresh();
    } catch (e) {
      error(e);
      await refresh();
      throw e;
    }
  }
  /** Asks the most recent running conversation to report each step's real state. */
  function askProgress() {
    const conversation = agentStore
      .getAll()
      .find((c) => c.id === mascotAgent);
    if (!conversation) {
      setToast('Reprenez la conversation de ce plan pour que l’agent fasse le point.');
      return;
    }
    void sendToAgent(
      conversation.id,
      'Fais le point sur l’avancement du plan : indique dans Galeata l’état réel de chaque étape (plan.update_step) d’après ce qui a déjà été fait, sans rien refaire.',
    ).catch(error);
  }

  function updateStep(step: Step, status: Step['status']) {
    void request<Plan>('plan.update_step', { id: step.id, status, revision: plan.revision, conversationId: mascotAgent || 'empty' })
      .then((result) => {
        setPlan(result);
        return refresh();
      })
      .catch((e) => {
        error(e);
        void refresh();
      });
  }
  function editObjective() {
    setDialog({
      title: 'Objectif de la mission',
      description: 'Ce cap reste sous votre contrôle. Les agents peuvent proposer son évolution.',
      fields: [
        {
          name: 'objective',
          label: 'Objectif',
          type: 'textarea',
          value: plan.objective,
          required: true,
        },
      ],
      onSubmit: async (values) => savePlan({ ...plan, objective: values.objective }),
    });
  }
  function fileAction(action: 'create' | 'rename' | 'delete', directory = false) {
    if (action !== 'create' && !active) return;
    if (action !== 'create' && activeFile?.content !== activeFile?.savedContent) {
      error('Enregistrez le fichier avant cette action.');
      return;
    }
    setDialog({
      title:
        action === 'create'
          ? directory
            ? 'Nouveau dossier'
            : 'Nouveau fichier'
          : action === 'rename'
            ? 'Renommer le fichier'
            : 'Supprimer le fichier',
      description:
        action === 'delete'
          ? `Supprimer définitivement ${active} ?`
          : 'Indiquez un chemin relatif au projet. Le dossier parent doit exister.',
      fields:
        action === 'delete'
          ? []
          : [
              {
                name: 'path',
                label: 'Chemin',
                value: action === 'rename' ? active : '',
                placeholder: 'src/nouveau-fichier.ts',
                required: true,
              },
            ],
      danger: action === 'delete',
      submit: action === 'delete' ? 'Supprimer' : 'Enregistrer',
      onSubmit: async (values) => {
        if (action === 'create')
          await request('workspace.create', { path: values.path, directory });
        else if (action === 'rename')
          await request('workspace.rename', { path: active, destination: values.path });
        else await request('workspace.delete', { path: active });
        if (action !== 'create') removeTab(active);
        setTreeRevision((value) => value + 1);
        if (action === 'rename' || (action === 'create' && !directory)) await openFile(values.path);
        await refresh();
      },
    });
  }
  function launchAgent(kind: string, sessionId?: string) {
    const launch = { key: crypto.randomUUID(), kind, sessionId };
    setTerminals((previous) => [...previous, { launch }]);
    setTerminalKey(launch.key);
    setBottom('terminal');
    setBottomVisible(true);
  }
  const terminalReady = useCallback(
    (key: string, id: string) =>
      setTerminals((previous) =>
        previous.map((tab) => (tab.launch.key === key ? { ...tab, id } : tab)),
      ),
    [],
  );
  const terminalExit = useCallback(
    (key: string) => {
      setTerminals((previous) =>
        previous.map((tab) => (tab.launch.key === key ? { ...tab, exited: true } : tab)),
      );
      void refresh();
      void loadSessions();
    },
    [refresh, loadSessions],
  );
  function closeTerminal(key: string) {
    setTerminals((previous) => previous.filter((tab) => tab.launch.key !== key));
    if (terminalKey === key)
      setTerminalKey(terminals.find((tab) => tab.launch.key !== key)?.launch.key ?? '');
  }
  async function mutateGit(action: string, args: Record<string, unknown> = {}) {
    if (gitRunning.current) throw new Error('Une opération Git est déjà en cours.');
    const changesFiles = ['branch', 'switch', 'merge', 'mergeAbort', 'mergeContinue', 'stash', 'stashPop', 'stashApply', 'pull'].includes(action);
    if (changesFiles && tabsRef.current.some((file) => file.content !== file.savedContent)) {
      const message = 'Enregistrez ou fermez vos onglets modifiés avant cette opération Git.';
      error(message);
      throw new Error(message);
    }
    const expected = getActiveWorkspace()?.id;
    gitRunning.current = true;
    setBusy(`Git · ${action}…`);
    try {
      const result = await request<GitStatus>('git.mutate', { action, ...args });
      if (getActiveWorkspace()?.id === expected) {
        setGit(result);
        setToast(action === 'fetch' ? 'Références distantes actualisées.' : action === 'push' ? 'Commits publiés.' : 'Opération Git terminée.');
      }
    } catch (e) {
      if (getActiveWorkspace()?.id === expected) error(e);
      throw e;
    } finally {
      if (getActiveWorkspace()?.id === expected) {
        // Merge/stash failures can still modify files. Refresh even on failure.
        if (changesFiles) {
          setDiff(null);
          setTreeRevision((value) => value + 1);
          const files = tabsRef.current;
          const loaded = await Promise.allSettled(files.map((file) => request<{ content: string; stamp: string }>('workspace.read', { path: file.path })));
          if (getActiveWorkspace()?.id === expected) setTabs((current) => current.map((file) => {
            const index = files.findIndex((previous) => previous.path === file.path);
            const result = loaded[index];
            if (!result || result.status !== 'fulfilled') return { ...file, external: true };
            return file.content !== file.savedContent ? { ...file, external: true }
              : { ...file, content: result.value.content, savedContent: result.value.content, stamp: result.value.stamp, external: false };
          }));
        }
        await refresh();
      }
      gitRunning.current = false;
      setBusy('');
    }
  }
  function gitDialog(action: 'branch' | 'switch' | 'worktree') {
    setDialog({
      title:
        action === 'branch'
          ? 'Créer une branche'
          : action === 'switch'
            ? 'Changer de branche'
            : 'Créer un worktree',
      fields: [
        { name: 'name', label: 'Branche', required: true, placeholder: 'feature/ma-mission' },
        ...(action === 'worktree'
          ? [
              {
                name: 'path',
                label: 'Nouveau dossier (chemin absolu)',
                required: true,
                placeholder: '/home/vous/projets/ma-mission',
              },
            ]
          : []),
      ],
      submit: 'Continuer',
      onSubmit: async (values) => mutateGit(action, values),
    });
  }

  useEffect(() => {
    if (!workspace || !query.trim()) {
      setHits([]);
      setSearchNext(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setHits([]);
    setSearchNext(null);
    setSearching(true);
    const timeout = setTimeout(() => {
      void request<{ items: SearchHit[]; nextOffset: number | null }>(
        'workspace.search_text',
        { query },
      )
        .then((result) => {
          if (!cancelled) {
            setHits(result.items);
            setSearchNext(result.nextOffset);
          }
        })
        .catch((e) => {
          if (!cancelled) error(e);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, workspace, error]);
  async function loadMoreSearch() {
    if (searchNext === null || searching) return;
    const expected = searchKeyRef.current;
    setSearching(true);
    try {
      const result = await request<{ items: SearchHit[]; nextOffset: number | null }>(
        'workspace.search_text',
        { query, offset: searchNext },
      );
      if (searchKeyRef.current !== expected) return;
      setHits((previous) => [...previous, ...result.items]);
      setSearchNext(result.nextOffset);
    } catch (value) {
      if (searchKeyRef.current === expected) error(value);
    } finally {
      if (searchKeyRef.current === expected) setSearching(false);
    }
  }

  useEffect(() => {
    if (palette && symbolVisible && symbolSearch.current) {
      const search = symbolSearch.current;
      let cancelled = false;
      setSymbols([]);
      if (!paletteQuery.trim()) return;
      const timer = setTimeout(() => { void search(paletteQuery.trim()).then(symbols => { if (!cancelled) setSymbols(symbols.slice(0, 100)); }).catch(value => { if (!cancelled) error(value); }); }, 200);
      return () => { cancelled = true; clearTimeout(timer); };
    }
    if (!palette || symbolVisible || !paletteQuery.trim() || !workspace) {
      setPaletteHits([]);
      return;
    }
    let cancelled = false;
    setPaletteHits([]);
    const timer = setTimeout(() => {
      void request<{ items: SearchHit[] }>('workspace.search_files', { query: paletteQuery })
        .then((result) => {
          if (!cancelled) setPaletteHits(result.items.slice(0, 20));
        })
        .catch(error);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [palette, symbolVisible, paletteQuery, workspace, error]);
  useEffect(() => {
    const searchShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.shiftKey && event.key.toLowerCase() === 'f' && workspace) {
        event.preventDefault(); event.stopPropagation(); openProjectSearch();
      }
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault(); event.stopPropagation();
        setSymbolVisible(false); setPaletteQuery(''); setPalette((value) => !value);
      }
    };
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (active) void saveFile(active).catch(() => {});
      }
      if (event.key === '`') {
        event.preventDefault();
        setBottomVisible((value) => !value);
      }
    };
    window.addEventListener('keydown', searchShortcut, true);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', searchShortcut, true);
      window.removeEventListener('keydown', handler);
    };
  });
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (tabsRef.current.some((file) => file.content !== file.savedContent))
        event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const nativeWindow = getCurrentWindow();
        cleanup = await nativeWindow.onCloseRequested((event) => {
          if (!tabsRef.current.some((file) => file.content !== file.savedContent)) return;
          event.preventDefault();
          setDialog({
            title: 'Fermer Galeata',
            description: 'Certains fichiers contiennent des modifications non enregistrées.',
            fields: [
              {
                name: 'action',
                label: 'Action',
                options: [
                  { value: 'save', label: 'Tout enregistrer puis quitter' },
                  { value: 'discard', label: 'Abandonner les modifications et quitter' },
                ],
              },
            ],
            submit: 'Quitter',
            onSubmit: async (values) => {
              if (values.action === 'save')
                for (const file of tabsRef.current) await saveFile(file.path);
              await nativeWindow.destroy();
            },
          });
        });
        if (disposed) cleanup();
      })
      .catch(error);
    return () => {
      disposed = true;
      cleanup?.();
    };
    // saveFile reads current buffers through tabsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  function runVerification() { setChecksOpen(true); }
  async function acceptProposal(event: Activity) {
    if (event.data.baseRevision !== plan.revision) {
      error('Le plan a évolué depuis cette proposition. Demandez une proposition actualisée.');
      return;
    }
    const steps = Array.isArray(event.data.steps)
      ? event.data.steps.map((value: unknown) => {
          const step = value as Partial<Step>;
          return {
            id: step.id || crypto.randomUUID(),
            title: String(step.title ?? ''),
            status: step.status ?? 'pending',
            note: step.note ?? '',
            author: 'vous',
            updatedAt: Date.now(),
          };
        })
      : plan.steps;
    await savePlan({ ...plan, objective: String(event.data.objective ?? plan.objective), steps });
  }
  const displayFile: OpenFile | undefined = diff
    ? diff.editable && activeFile?.path === diff.path
      ? activeFile
      : {
          path: diff.path,
          content: diff.modified,
          savedContent: diff.modified,
          stamp: '',
          language: languageFor(diff.path),
        }
    : activeFile;
  const editorDiff = diff
    ? {
        original: diff.original,
        modified:
          diff.editable && activeFile?.path === diff.path ? activeFile.content : diff.modified,
        editable: diff.editable && activeFile?.path === diff.path,
      }
    : undefined;

  // Shared central editor for Files and Git.
  const codeArea = (
    <>
      <div className="editor-tabs">
        <div className="tab-list" role="tablist" aria-label="Fichiers ouverts">
          {(reviewing ? [] : [...tabs].sort((a,b) => Number(pinnedFiles.includes(b.path)) - Number(pinnedFiles.includes(a.path)))).map((file) => (
            <div
              key={file.path}
              className={`editor-tab ${active === file.path && !diff ? 'active' : ''}`}
            >
              <Button
                role="tab"
                aria-selected={active === file.path && !diff}
                aria-label={file.path.split('/').pop()}
                title={file.path}
                onClick={() => {
                  setActive(file.path);
                  setDiff(null);
                }}
              >
                <span className="tab-file-icon">
                  <Icon name={/\.(tsx?|rs|json|css|html)$/.test(file.path) ? "file-code" : "files"} size={14} />
                </span>
                {file.path.split('/').pop()}
                {pinnedFiles.includes(file.path) ? " · épinglé" : ""}
                {file.content !== file.savedContent ? <span className="dirty-dot" /> : null}
              </Button>
              <Button
                className="tab-close"
                aria-label={`Fermer ${file.path}`}
                onClick={() => closeTab(file.path)}
              >
                <Icon name="close" size={12} />
              </Button>
            </div>
          ))}
          {diff ? (
            <div className="editor-tab active">
              <Button role="tab" aria-selected="true">
                <Icon name="git" size={13} />
                {diff.path.split('/').pop()} · {diff.staged ? 'indexé' : 'diff'}
                {diff.editable && activeFile?.path === diff.path && activeFile.content !== activeFile.savedContent ? <span className="dirty-dot" /> : null}
              </Button>
              <Button
                className="tab-close"
                aria-label="Fermer le diff"
                onClick={() => setDiff(null)}
              >
                <Icon name="close" size={12} />
              </Button>
            </div>
          ) : null}
          {!tabs.length && !diff ? <span className="empty-tab">Bienvenue dans Galeata</span> : null}
        </div>
        <div className="editor-tab-actions">
          <ChoicePicker actionMenu className="editor-file-actions" label="Actions du fichier" fallback="Fichier" options={[
            { id: 'split', label: 'Afficher ce fichier à côté' },
            ...(splitFile ? [{ id: 'close-split', label: 'Fermer la deuxième vue' }] : []),
            { id: 'pin', label: pinnedFiles.includes(active) ? 'Désépingler le fichier' : 'Épingler le fichier' },
            { id: 'rename', label: 'Renommer le fichier' },
            { id: 'delete', label: 'Supprimer le fichier', danger: true },
          ]} disabled={!activeFile || !!diff} onChange={action => {
            if (action === 'split') setSplitFile(active);
            else if (action === 'close-split') setSplitFile('');
            else if (action === 'pin') setPinnedFiles(files => files.includes(active) ? files.filter(path => path !== active) : [...files, active]);
            else fileAction(action as 'rename' | 'delete');
          }} />
          <Button variant="icon" title="Préférences de l’éditeur" aria-label="Préférences de l’éditeur" onClick={openEditorPreferences}><Icon name="settings" size={14} /></Button>
          <Button
            variant="icon"
            title="Enregistrer le fichier"
            aria-label="Enregistrer le fichier"
            disabled={!desktop || !activeFile || (!!diff && !editorDiff?.editable)}
            onClick={() => void saveFile(active).catch(() => {})}
          >
            <Icon name="save" size={14} />
          </Button>
        </div>
      </div>
      {displayFile ? (
        <>
          <div className="breadcrumbs">
            <Icon name="folder" size={13} />
            <span>{workspace?.name}</span>
            {displayFile.path.split('/').map((part, index) => (
              <span key={index}>
                <Icon name="chevron" size={10} />
                {part}
              </span>
            ))}

          </div>
          {activeFile?.external && !diff ? (
            <div className="conflict-banner">
              <Icon name="warning" size={15} />
              <span>Ce fichier a changé sur disque. Vos modifications sont conservées.</span>
              <Button className="text-button" onClick={() => {
                const expected = workspace?.id;
                void Promise.resolve(pendingSaves.current.get(`${expected}:${active}`)).catch(() => {}).then(() => request<{ content: string; stamp: string }>('workspace.read', { path: active })).then(disk => {
                  if (getActiveWorkspace()?.id !== expected) return;
                  failedSaves.current.delete(`${expected}:${active}`);
                  setTabs(files => files.map(file => file.path === active ? { ...file, savedContent: disk.content, stamp: disk.stamp, external: false } : file));
                }).catch(error);
              }}>Conserver mes changements</Button>
              <Button
                className="text-button"
                onClick={() => {
                  void request<{ content: string; stamp: string }>('workspace.read', {
                    path: active,
                  })
                    .then((result) =>
                      setDiff({
                        path: active,
                        original: result.content,
                        modified: activeFile.content,
                        staged: false,
                        editable: true,
                      }),
                    )
                    .catch(error);
                }}
              >
                Comparer
              </Button>
              <Button
                className="text-button"
                onClick={() =>
                  setDialog({
                    title: 'Recharger le fichier',
                    description: 'Abandonner vos modifications et charger la version du disque ?',
                    fields: [],
                    submit: 'Recharger',
                    danger: true,
                    onSubmit: async () => {
                      const result = await request<{ content: string; stamp: string }>(
                        'workspace.read',
                        { path: active },
                      );
                      setTabs((previous) =>
                        previous.map((file) =>
                          file.path === active
                            ? {
                                ...file,
                                content: result.content,
                                savedContent: result.content,
                                stamp: result.stamp,
                                external: false,
                              }
                            : file,
                        ),
                      );
                    },
                  })
                }
              >
                Recharger
              </Button>
            </div>
          ) : null}
          <div className="editor-split">
          <Suspense fallback={<div className="loading-editor">Préparation de l’éditeur…</div>}>
            <EditorSurface
              key={`${workspace?.id}:${displayFile.path}:${diff ? 'diff' : 'edit'}:${diff?.original ?? ''}`}
              preferences={editorPreferences}
              projectRoot={workspace?.root ?? ""}
              onOpen={(path, line, column) => void openFile(path, line, true, column)}
              modelKey={`${workspace?.id}:${displayFile.path}`}
              file={displayFile}
              diff={editorDiff}
              line={line}
              column={column}
              revealRequest={revealRequest}
              onChange={(content) => {
                            mascot.react('text-edit');
                setTabs((previous) =>
                  previous.map((file) => (file.path === active ? { ...file, content } : file)),
                );
              }}
              onSave={() => void saveFile(active).catch(() => {})}
            />
          </Suspense>
          {!diff && splitFile && tabs.find(file => file.path === splitFile) ? <Suspense fallback={null}>
            <EditorSurface key={`${workspace?.id}:${splitFile}:second`} modelKey={`${workspace?.id}:${splitFile}`}
              projectRoot={workspace?.root ?? ''} preferences={editorPreferences}
              onOpen={(path, line, column) => void openFile(path, line, true, column)} file={tabs.find(file => file.path === splitFile)!}
              onChange={content => { setTabs(files => files.map(file => file.path === splitFile ? { ...file, content } : file)); }}
              onSave={() => void saveFile(splitFile).catch(() => {})} />
          </Suspense> : null}
          </div>
          <EditorStatus file={displayFile} editable={!diff || !!editorDiff?.editable} native={desktop} autoSave={autoSave}
            phase={saveStates[`${workspace?.id}:${displayFile.path}`] === 'error' && failedSaves.current.get(`${workspace?.id}:${displayFile.path}`) !== displayFile.content ? undefined : saveStates[`${workspace?.id}:${displayFile.path}`]} localDraftSaved={persistedDrafts[displayFile.path] === displayFile.content} draftError={draftError}
            onPreferences={openEditorPreferences} onRetry={() => void saveFile(displayFile.path).catch(() => {})}
            onLanguage={language => setTabs(files => files.map(file => file.path === displayFile.path ? { ...file, language } : file))} />
        </>
      ) : (
        <div className="code-empty">
          <Icon name={reviewing ? 'git' : 'files'} size={28} />
          {reviewing ? (
            <>
              <p>
                Choisissez un fichier modifié dans Contrôle de source pour relire ses changements.
              </p>
              {git.files.length ? (
                <Button variant="primary" onClick={() => void showDiff(git.files[0].path)}>
                  Relire {git.files[0].path}
                </Button>
              ) : (
                <p className="muted">Aucun changement local.</p>
              )}
            </>
          ) : (
            <p>Ouvrez un fichier depuis l’explorateur ou depuis une conversation.</p>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src={theme === 'night' ? '/galeata-logo-night.svg' : '/galeata-logo.svg'} alt="Galeata" />
        </div>
        <div className="topbar-divider" />
        <Button className="workspace-picker" title={workspace ? "Ouvrir un projet dans une nouvelle fenêtre" : "Ouvrir un projet"} onClick={openFolder}>
          <Icon name="folder" size={15} />
          <span>{workspace?.name ?? 'Ouvrir un projet'}</span>
          <Icon name="chevron" size={12} className="rotated" />
        </Button>
        <Button className="command-trigger" onClick={() => { setSymbolVisible(false); setPaletteQuery(''); setPalette(true); }}>
          <Icon name="search" size={14} />
          <span>Rechercher un fichier ou une action…</span>
          <kbd>Ctrl P</kbd>
        </Button>
        <div className="topbar-actions">
          {!desktop ? (
            <span className="preview-badge">APERÇU INTERFACE</span>
          ) : (
            <span className="local-badge">
              <span className="status-dot" /> Local
            </span>
          )}


        </div>
      </header>
      <main className="workspace-layout" ref={layoutRef}>
        <nav className="activity-rail" aria-label="Navigation principale">
          <div>
            {navigation.map((item, index) => (
              <Button
                key={item.id}
                className={`rail-button ${panel === item.id ? 'active' : ''}`}
                title={item.label}
                aria-label={item.label}
                aria-pressed={panel === item.id}
                onClick={() => navigate(item.id)}
              >
                <span className="rail-index" aria-hidden="true">0{index + 1}</span>
                <Icon name={item.icon} size={19} />
                <span className="rail-label" aria-hidden="true">{item.id === 'agents' ? 'Agents' : item.label}</span>
                {item.id === 'git' && git.files.length ? (
                  <CountBadge count={git.files.length} label="fichiers modifiés" placement="navigation" />
                ) : item.id === 'agents' ? (
                  <AgentCountBadge events={activities} />
                ) : null}
              </Button>
            ))}
          </div>
          <div>
            <Button
              className="rail-button"
              title="Historique"
              aria-label="Historique"
              onClick={() => {
                setBottom('activity');
                setBottomVisible(true);
              }}
            >
              <Icon name="history" size={21} />
            </Button>
            <Button
              className={`rail-button ${preferencesOpen ? 'active' : ''}`}
              aria-label="Préférences"
              title="Préférences"
              onClick={openPreferences}
            >
              <Icon name="settings" size={21} />
            </Button>
            <TurtleMascot compact agentId={mascotAgent || undefined} />
          </div>
        </nav>
        {panel !== 'agents' && panel !== 'tools' ? <>
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="panel-heading">
            <span>{panelNames[panel]}</span>
            <Button
              variant="icon"
              aria-label="Actualiser"
              title="Actualiser"
              disabled={!workspace}
              onClick={() => {
                void refresh();
                setTreeRevision((value) => value + 1);
              }}
            >
              <Icon name="refresh" size={14} />
            </Button>
          </div>
          {!workspace ? (
            <div className="sidebar-empty">
              <Icon name="folder" size={25} />
              <p>Votre prochain projet commence ici.</p>
              <Button className="button small" onClick={openFolder}>
                Ouvrir un dossier
              </Button>
            </div>
          ) : (
            <>
              {panel === 'files' ? (
                <>
                  <div className="project-heading">
                    <span>
                      <Icon name="chevron" className="rotated" size={12} />
                      {workspace.name.toUpperCase()}
                    </span>
                    <div>
                      <Button
                        variant="icon"
                        title="Nouveau fichier"
                        aria-label="Nouveau fichier"
                        onClick={() => fileAction('create')}
                      >
                        <Icon name="plus" size={14} />
                      </Button>
                      <Button
                        variant="icon"
                        title="Nouveau dossier"
                        aria-label="Nouveau dossier"
                        onClick={() => fileAction('create', true)}
                      >
                        <Icon name="folder" size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="file-tools" role="group" aria-label="Outils des fichiers">
                    <Button className="text-button" aria-pressed={!fileSearchVisible} onClick={() => setFileSearchVisible(false)}><Icon name="folder" size={14} /> Arborescence</Button>
                    <Button className="text-button" aria-pressed={fileSearchVisible} title="Rechercher dans les fichiers (Ctrl+Shift+F)" onClick={openProjectSearch}><Icon name="search" size={14} /> Rechercher</Button>
                  </div>
                  <div className="file-search-panel" hidden={!fileSearchVisible}><FileSearch query={query} hits={hits} searching={searching}
                    onReplace={(query, replacement, include, exclude) => void previewReplacement(query, replacement, include, exclude).catch(error)}
                    hasMore={searchNext !== null} onQuery={setQuery}
                    onOpen={hit => void openFile(hit.path, hit.line || undefined, false)} onMore={() => void loadMoreSearch()} /></div>
                  <div hidden={fileSearchVisible}>
                  <FileTree key={workspace.id}
                    workspaceId={workspace.id}
                    revision={treeRevision}
                    selected={active}
                    onOpen={(path) => void openFile(path)}
                    onError={error}
                  />
                  </div>
                </>
              ) : null}
              {panel === 'git' ? (
                <div className="sidebar-content">
                  {git.isRepo ? (
                    <>
                      <div className="section-line">
                        <span className="branch-name">
                          <Icon name="branch" size={15} />
                          {git.branch}
                        </span>
                        <CountBadge count={git.files.length} label="fichiers modifiés" />
                      </div>
                      <Button className="sidebar-action" onClick={() => setGitManager('branches')}><Icon name="branch" size={15} /> Branches et synchronisation</Button>
                      <Button className="sidebar-action" onClick={() => setGitManager('stashes')}><Icon name="history" size={15} /> Mettre de côté / restaurer</Button>
                      {git.merging || git.files.some((file) => file.conflicted) ? <div className="git-notice"><strong>{git.merging ? 'Fusion en cours' : 'Conflits à résoudre'}</strong><p>Corrigez les fichiers en conflit, puis indexez-les.</p><Button className="text-button" onClick={() => setGitManager('branches')}>Suivre la résolution</Button></div> : null}
                      <TextArea
                        className="commit-input"
                        aria-label="Message de commit"
                        placeholder="Décrire les changements…"
                        rows={3}
                        value={commitMessage}
                        onChange={(event) => setCommitMessage(event.target.value)}
                      />
                      <Button
                        className="button full"
                        disabled={!commitMessage.trim() || !!busy}
                        onClick={() =>
                          void mutateGit('commit', { message: commitMessage })
                            .then(() => setCommitMessage(''))
                            .catch(() => {})
                        }
                      >
                        <Icon name="check" size={15} />
                        Créer le commit
                      </Button>
                      <div className="section-line">
                        <h3>Changements</h3>
                        <CountBadge count={git.files.length} label="fichiers modifiés" />
                      </div>
                      {git.files.map((file) => (
                        <div className="git-file" key={file.path}>
                          <Button
                            className="truncate"
                            title={`Diff non indexé : ${file.path}`}
                            onClick={() => void showDiff(file.path, false)}
                          >
                            <span className={`git-status-letter ${file.conflicted ? 'conflicted' : ''}`}>
                              {file.worktree === ' ' ? file.index : file.worktree}
                            </span>
                            {file.path}
                          </Button>
                          {file.index !== ' ' && file.index !== '?' ? (
                            <>
                              <Button
                                variant="icon"
                                title="Voir le diff indexé"
                                aria-label={`Diff indexé ${file.path}`}
                                onClick={() => void showDiff(file.path, true)}
                              >
                                <Icon name="files" size={13} />
                              </Button>
                              <Button
                                variant="icon"
                                title="Désindexer"
                                aria-label={`Désindexer ${file.path}`}
                                onClick={() =>
                                  void mutateGit('unstage', { path: file.path }).catch(() => {})
                                }
                              >
                                −
                              </Button>
                            </>
                          ) : null}
                          <Button
                            variant="icon"
                            title="Indexer"
                            aria-label={`Indexer ${file.path}`}
                            onClick={() =>
                              void mutateGit('stage', { path: file.path }).catch(() => {})
                            }
                          >
                            <Icon name="plus" size={13} />
                          </Button>
                        </div>
                      ))}
                      {!git.files.length ? (
                        <div className="empty-state compact">
                          <Icon name="check" size={24} />
                          <p>Aucun changement local.</p>
                        </div>
                      ) : null}
                      <div className="section-line">
                        <h3>Branches & isolation</h3>
                      </div>
                      <Button className="sidebar-action" onClick={() => setGitManager('branches')}>
                        <Icon name="branch" size={15} />
                        Créer une branche
                      </Button>
                      <Button className="sidebar-action" onClick={() => gitDialog('worktree')}>
                        <Icon name="folder" size={15} />
                        Créer un worktree
                      </Button>
                      <Button
                        className="sidebar-action"
                        onClick={() => {
                          void request<string>('git.worktrees')
                            .then((text) =>
                              setDialog({
                                title: 'Worktrees du projet',
                                description: text,
                                fields: [],
                                submit: 'Fermer',
                                onSubmit: async () => {},
                              }),
                            )
                            .catch(error);
                        }}
                      >
                        <Icon name="files" size={15} />
                        Voir les worktrees
                      </Button>
                    </>
                  ) : (
                    <div className="empty-state compact">
                      <Icon name="git" size={28} />
                      <p>Ce dossier n’est pas un dépôt Git.</p>
                      <span className="muted">
                        Initialisez-le depuis le terminal pour activer le suivi.
                      </span>
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </aside>
        <Splitter
          label="Largeur du panneau latéral"
          orientation="vertical"
          size={sidebarWidth}
          bounds={sidebarBounds}
          direction={1}
          onResize={(size) =>
            setSidebarWidth(
              Math.min(
                size,
                sideRoom((planShown ? planWidth : 0)),
              ),
            )
          }
          onReset={() => setSidebarWidth(sidebarDefault)}
        />
        </> : null}
        <section className="central-workspace" aria-label="Espace de travail" ref={centralRef}>
          {workspace && toolsVisited ? <div className="tools-layer" hidden={panel !== 'tools'}><ToolConfiguration key={workspace.id} onConnect={provider => launchAgent(`${provider}-login`)} /></div> : null}
          {workspace ? (
            <div className="agent-layer" hidden={!agentPage}>
              <AgentWorkspace key={workspace.id} workspaceId={workspace.id}
                providers={providers}
                missionEvents={activities}
                missionPlan={plan}
                sessions={sessions}
                onOpenFile={(path) => void openFile(path)}
                onShowDiff={(path) => void showDiff(path)}
                onOpenTerminal={(provider, sessionId) => launchAgent(provider, sessionId)}
                defaultAgent={defaultAgent}
                onOpenPreferences={openPreferences}
                onError={error}
                onRefreshProviders={() => void loadSessions()}
                onActiveChange={setMascotAgent}
              />
            </div>
          ) : null}
          {filesPage ? (
            <section className="review-area files-area" aria-label="Fichiers du projet">
              {activeFile ? codeArea : <FilesHome workspace={workspace} git={git}
                onFind={() => { setSymbolVisible(false); setPaletteQuery(''); setPalette(true); }}
                onCreate={() => fileAction('create')} onOpen={(path) => void openFile(path)} />}
            </section>
          ) : null}
          {reviewing ? (
            <section className="review-area" aria-label="Relecture du code">
              <GitToolbar git={git} busy={!!busy} onManage={setGitManager}
                onMutate={(action) => void mutateGit(action).catch(() => {})} />
              {diff ? <>
                <div className="diff-page-toolbar">
                  <Button className="text-button" onClick={() => setDiff(null)}><Icon name="git" size={15} /> Vue d’ensemble</Button>
                  <span>{diff.staged ? 'HEAD → Index' : 'Index → Fichier de travail'}</span>
                  <Button className="text-button" onClick={() => { navigate('files'); void openFile(diff.path); }}>Ouvrir le fichier <Icon name="arrow" size={14} /></Button>
                </div>
                {codeArea}
              </> : <GitOverview git={git} onDiff={(path, staged) => void showDiff(path, staged)} onRefresh={() => void refresh()}
                onTerminal={() => { setBottom('terminal'); setBottomVisible(true); }} />}
            </section>
          ) : null}
          {workspace ? null : (
            <div className="welcome">
              <div className="welcome-emblem">
                <Icon name="spark" size={48} />
              </div>
              <span className="eyebrow">VOTRE CODE. VOS AGENTS. UNE VISION CLAIRE.</span>
              <h1>
                Gardez le fil.
                <br />
                <span>Construisez la suite.</span>
              </h1>
              <p>
                Un espace pour vos fichiers, vos agents et le plan qui les relie. Reprenez
                exactement là où vous en étiez.
              </p>
              <div className="welcome-actions">
                <Button variant="primary" onClick={openFolder}>
                  <Icon name="folder" size={16} />
                  Ouvrir un dossier
                  <Icon name="arrow" size={15} />
                </Button>
                {desktop && localStorage.getItem('galeata:last-workspace') ? (
                  <Button
                    className="text-button"
                    onClick={() =>
                      void chooseWorkspace(
                        localStorage.getItem('galeata:last-workspace') ?? undefined,
                      )
                    }
                  >
                    Reprendre le dernier projet
                  </Button>
                ) : null}
              </div>
              <div className="welcome-features">
                <span>
                  <Icon name="plan" size={16} />
                  Un plan vivant
                </span>
                <span>
                  <Icon name="agents" size={16} />
                  Vos outils habituels
                </span>
                <span>
                  <Icon name="git" size={16} />
                  Des changements lisibles
                </span>
              </div>
            </div>
          )}
          {bottomVisible ? (
            <Splitter
              label="Hauteur du panneau inférieur"
              orientation="horizontal"
              size={bottomHeight}
              bounds={bottomBounds}
              direction={-1}
              onResize={(size) =>
                setBottomHeight(
                  Math.min(size, (centralRef.current?.clientHeight ?? Infinity) - editorMinHeight),
                )
              }
              onReset={() => setBottomHeight(bottomDefault)}
            />
          ) : null}
          {bottomVisible ? (
            <section
              className="bottom-panel"
              aria-label="Terminal et activité"
              style={{ height: bottomHeight }}
            >
              <div className="bottom-heading">
                <div className="bottom-tabs" role="tablist" aria-label="Outils du projet">
                  {(
                    [
                      { id: 'terminal', label: 'Terminal', icon: 'terminal' },
                      { id: 'activity', label: 'Activité', icon: 'history' },
                      { id: 'checks', label: 'Vérifications', icon: 'check' },
                    ] as const
                  ).map((item) => (
                    <Button
                      key={item.id}
                      role="tab"
                      aria-selected={bottom === item.id}
                      className={bottom === item.id ? 'active' : ''}
                      onClick={() => setBottom(item.id)}
                    >
                      <Icon name={item.icon} size={13} />
                      {item.label}
                      {item.id === 'activity' && activities.length ? (
                        <CountBadge count={activities.length} label="activités" />
                      ) : null}
                    </Button>
                  ))}
                </div>
                <div>
                  <Button
                    variant="icon"
                    title="Nouveau terminal"
                    aria-label="Nouveau terminal"
                    disabled={!workspace || !desktop}
                    onClick={() => launchAgent('shell')}
                  >
                    <Icon name="plus" size={14} />
                  </Button>
                  <Button
                    variant="icon"
                    title="Masquer le terminal"
                    aria-label="Masquer le terminal"
                    onClick={() => setBottomVisible(false)}
                  >
                    <Icon name="close" size={14} />
                  </Button>
                </div>
              </div>
              <div className="terminal-area" hidden={bottom !== 'terminal'}>
                {terminals.length ? (
                  <>
                    <div className="terminal-tabs">
                      {terminals.map((tab) => (
                        <div
                          className={terminalKey === tab.launch.key ? 'active' : ''}
                          key={tab.launch.key}
                        >
                          <Button onClick={() => setTerminalKey(tab.launch.key)}>
                            <span className={`status-dot ${tab.exited ? 'idle' : ''}`} />
                            {tab.launch.kind}
                            {tab.exited ? ' · terminé' : ''}
                          </Button>
                          <Button
                            aria-label={`Fermer le terminal ${tab.launch.kind}`}
                            onClick={() => closeTerminal(tab.launch.key)}
                          >
                            <Icon name="close" size={11} />
                          </Button>
                        </div>
                      ))}
                    </div>
                    {terminals.map((tab) => (
                      <div
                        className="terminal-mount"
                        key={tab.launch.key}
                        hidden={terminalKey !== tab.launch.key}
                      >
                        <Suspense fallback={<p className="muted">Préparation du terminal…</p>}>
                          <TerminalView
                            launch={tab.launch}
                            onReady={terminalReady}
                            onExit={terminalExit}
                            active={terminalKey === tab.launch.key && bottom === 'terminal'}
                          />
                        </Suspense>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="terminal-idle">
                    <div>
                      <Icon name="chevron" size={14} className="prompt-symbol" />
                      <span>
                        {!desktop
                          ? 'Aperçu de l’interface · aucun processus local connecté.'
                          : workspace
                            ? 'Un terminal, votre shell, votre projet.'
                            : 'Ouvrez un projet pour utiliser le terminal.'}
                      </span>
                      <span className="terminal-cursor" />
                    </div>
                    {workspace && desktop ? (
                      <Button className="text-button" onClick={() => launchAgent('shell')}>
                        Ouvrir un terminal <Icon name="plus" size={13} />
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
              {bottom !== 'terminal' ? (
                <ActivityFeed
                  events={activities}
                  checksOnly={bottom === 'checks'}
                  plan={plan}
                  onOpen={(path) => void openFile(path)}
                  onDiff={(path) => void showDiff(path)}
                  onProposal={(event) =>
                    setDialog({
                      title: 'Accepter la proposition',
                      description: `${event.message}\n\nNouvel objectif : ${String(event.data.objective ?? '')}`,
                      fields: [],
                      submit: 'Appliquer au plan',
                      onSubmit: async () => acceptProposal(event),
                    })
                  }
                />
              ) : null}
            </section>
          ) : null}
        </section>
        {planShown ? (
          <Splitter
            label="Largeur du plan"
            orientation="vertical"
            size={planWidth}
            bounds={planBounds}
            direction={-1}
            onResize={(size) =>
              setPlanWidth(
                Math.min(size, sideRoom(sidebarWidth)),
              )
            }
            onReset={() => setPlanWidth(planDefault)}
          />
        ) : null}
        {planShown ? (
          <PlanPanel
            width={planWidth}
            plan={plan}
            activities={activities}
            onSave={savePlan}
            onStep={updateStep}
            onHistory={() => {
              setBottom('activity');
              setBottomVisible(true);
            }}
            onEdit={editObjective}
            onAskProgress={askProgress}
          />
        ) : null}
      </main>
      {checksOpen && workspace ? <ChecksDialog key={workspace.id} workspaceId={workspace.id}
        dirty={tabs.some(file => file.content !== file.savedContent)} onClose={() => setChecksOpen(false)} /> : null}
      {preferencesOpen ? <PreferencesDialog initialSection={preferencesSection} editor={workspace ? <EditorPreferencesPanel project={workspace.name} value={editorPreferences} autoSave={autoSave} language={activeFile?.language} languageInfo={activeFile ? languageInfo[activeFile.language] : undefined} error={editorPreferenceError} onChange={updateEditorPreferences} onAutoSave={updateAutoSave} /> : undefined} theme={theme} defaultAgent={defaultAgent} providers={providers}
        onThemeChange={value => { applyTheme(value); setTheme(value); }}
        onAgentChange={value => { writeDefaultAgent(value); setDefaultAgent(value); }}
        onClose={() => setPreferencesOpen(false)} /> : null}
      {gitManager && workspace ? <GitManager key={workspace.id} workspaceId={workspace.id} git={git}
        initialTab={gitManager} busy={!!busy} dirty={tabs.some((file) => file.content !== file.savedContent)}
        onClose={() => setGitManager(null)} onMutate={mutateGit} /> : null}
      <footer className="statusbar">
        <div>
          {git.isRepo ? (
            <Button aria-label={`Gérer les branches : ${git.branch}`} title="Changer de branche, fusionner et gérer les stash" onClick={() => setGitManager('branches')}>
              <Icon name="branch" size={12} />
              {git.branch}
            </Button>
          ) : (
            <span>
              <Icon name="folder" size={12} />
              {workspace ? 'Dossier local' : 'Aucun projet'}
            </span>
          )}
          <ChecksStatusButton workspaceId={workspace?.id} open={checksOpen} onClick={runVerification} />
        </div>
        <div>
          <span className="status-message">
            {busy ||
              (desktop ? 'Tout reste sur votre machine' : 'Démonstration · fichiers d’exemple')}
          </span>
          {activeFile && panel !== 'files' ? (
            <>
              <span>UTF-8</span>
              <span>{activeFile.language}</span>
            </>
          ) : null}
          <Button
            aria-label="Afficher le terminal"
            title="Afficher le terminal"
            onClick={() => setBottomVisible((value) => !value)}
          >
            <Icon name="terminal" size={13} />
          </Button>
          <span className="status-dot" />
        </div>
      </footer>
      {toast ? (
        <div className="toast" role="alert">
          <Icon name="warning" size={18} />
          <span>{toast}</span>
          <Button
            variant="icon"
            aria-label="Fermer le message"
            onClick={() => setToast('')}
          >
            <Icon name="close" size={15} />
          </Button>
        </div>
      ) : null}
      {editPreview ? <EditPreview title={editPreview.title} files={editPreview.files} onApply={applyProposedEdits} onClose={() => setEditPreview(null)} /> : null}
      {dialog ? <Dialog key={dialog.title} spec={dialog} onClose={() => setDialog(null)} /> : null}
      {palette ? (
        <div className="palette-backdrop" onClick={() => setPalette(false)}>
          <section
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Fichiers et actions"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setPalette(false);
              if (event.key === 'Enter' && event.target instanceof HTMLInputElement && symbolVisible) {
                const symbol = symbols.find(symbol => symbol.name.toLocaleLowerCase().includes(paletteQuery.toLocaleLowerCase()));
                if (symbol) { event.preventDefault(); void openFile(symbol.path, symbol.line); setPalette(false); }
                return;
              }
              if (event.key === 'Enter' && event.target instanceof HTMLInputElement && paletteHits[0]) {
                event.preventDefault(); navigate('files');
                void openFile(paletteHits[0].path, undefined, false);
                setPalette(false); setPaletteQuery('');
              }
            }}
          >
            <div className="palette-input">
              <Icon name="search" />
              <TextInput
                autoFocus
                aria-label="Fichier ou action"
                placeholder={symbolVisible ? 'Rechercher un symbole…' : 'Rechercher un fichier ou choisir une action…'}
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="palette-results">
              {symbolVisible ? (
                <>{!symbols.length ? <p className="muted">{symbolSearch.current && !paletteQuery.trim() ? 'Rechercher un symbole par son nom…' : 'Aucun symbole disponible.'}</p> : null}{symbols.filter(symbol => symbol.name.toLocaleLowerCase().includes(paletteQuery.toLocaleLowerCase())).map((symbol, index) => <Button key={`${symbol.path}:${symbol.line}:${index}`} onClick={() => { void openFile(symbol.path, symbol.line); setPalette(false); }}>
                  <Icon name="file-code" size={15} />{symbol.name}<small>{symbol.path}:{symbol.line}</small>
                </Button>)}</>
              ) : paletteQuery ? (
                paletteHits.map((hit) => (
                  <Button
                    key={hit.path}
                    onClick={() => {
                      navigate('files');
                      void openFile(hit.path, undefined, false);
                      setPalette(false);
                      setPaletteQuery('');
                    }}
                  >
                    <Icon name="files" size={15} />
                    {hit.path}
                  </Button>
                ))
              ) : (
                <>
                  {activeFile ? <>
                    <Button onClick={() => { setPalette(false); window.dispatchEvent(new CustomEvent('galeata:editor-command', { detail: { command: 'structure', path: active } })); }}>Aller à un symbole dans le fichier · Ctrl+Shift+O</Button>
                    <Button onClick={() => { setPalette(false); window.dispatchEvent(new CustomEvent('galeata:editor-command', { detail: { command: 'project-symbols', path: active } })); }}>Rechercher un symbole du projet · Ctrl+T</Button>
                  </> : null}
                  <Button
                    onClick={() => {
                      setPalette(false);
                      openFolder();
                    }}
                  >
                    <Icon name="folder" size={16} />
                    {workspace ? "Ouvrir un projet dans une nouvelle fenêtre" : "Ouvrir un dossier"}
                  </Button>
                  <Button
                    disabled={!workspace}
                    onClick={() => {
                      setPalette(false);
                      fileAction('create');
                    }}
                  >
                    <Icon name="plus" size={16} />
                    Créer un fichier
                  </Button>
                  <Button
                    disabled={!workspace || !desktop}
                    onClick={() => {
                      setPalette(false);
                      launchAgent('shell');
                    }}
                  >
                    <Icon name="terminal" size={16} />
                    Ouvrir un terminal
                  </Button>
                  <Button
                    onClick={() => {
                      setPalette(false);
                      setPanel('agents');
                    }}
                  >
                    <Icon name="agents" size={16} />
                    Voir les agents et les sessions
                  </Button>

                </>
              )}
              {paletteQuery && !paletteHits.length ? (
                <p className="muted">Aucun fichier trouvé.</p>
              ) : null}
            </div>
            <div className="palette-footer">
              Recherche dans le projet ouvert <kbd>Ctrl P</kbd>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

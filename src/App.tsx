import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { desktop, getActiveWorkspace, openWorkspace, request, subscribe } from './api.ts';
import { languageFor, relativeTime } from './domain.ts';
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
import { FilesHome, SearchPage, GitOverview } from './components/WorkspacePages.tsx';
import GitManager, { GitToolbar, type GitTab } from './components/GitManager.tsx';
import { sendToAgent, startAgent } from './agents/api.ts';
import { agentStore } from './agents/store.ts';
import { mascot } from './mascot/store.ts';
import TurtleMascot from './components/TurtleMascot.tsx';
import { providerNames, type Provider as AgentProvider } from './agents/types.ts';
import {
  agentModes,
  readDefaultAgent,
  readStartMode,
  writeDefaultAgent,
  writeStartMode,
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
const codeBounds = { min: 320, max: 1600 };
const codeDefault = 620;
const sidebarDefault = wide ? 270 : 245;
const planDefault = wide ? 345 : 315;
const bottomDefault = 220;
const editorMinWidth = 360; // the agent conversation keeps at least this width
const editorMinHeight = 120;
type Panel = 'files' | 'search' | 'git' | 'agents' | 'settings';
type Bottom = 'terminal' | 'activity' | 'checks';
interface TerminalTab {
  launch: TerminalLaunch;
  id?: string;
  exited?: boolean;
}
const panelNames: Record<Panel, string> = {
  files: 'Explorateur',
  search: 'Recherche',
  git: 'Contrôle de source',
  agents: 'Agents & sessions',
  settings: 'Préférences',
};
const navigation: { id: Panel; icon: string; label: string }[] = [
  { id: 'files', icon: 'files', label: 'Fichiers' },
  { id: 'search', icon: 'search', label: 'Rechercher' },
  { id: 'git', icon: 'git', label: 'Git' },
  { id: 'agents', icon: 'agents', label: 'Agents et sessions' },
];

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [panel, setPanel] = useState<Panel>('agents');
  const [mascotAgent, setMascotAgent] = useState('');
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
  const [diff, setDiff] = useState<{
    path: string;
    original: string;
    modified: string;
    staged: boolean;
    /** The right side is the working file itself: edits go to its tab and are saved to disk. */
    editable: boolean;
  } | null>(null);
  const [treeRevision, setTreeRevision] = useState(0);
  const [planVisible, setPlanVisible] = useState(
    () => localStorage.getItem('galeata:plan-visible') !== 'false',
  );
  const [bottomVisible, setBottomVisible] = useState(
    () => localStorage.getItem('galeata:bottom-visible') === 'true',
  );
  // Code is secondary: a right-hand panel opened on demand (file, diff, agent request).
  const [codeVisible, setCodeVisible] = useState(false);
  const [defaultAgent, setDefaultAgent] = useState<AgentProvider>(readDefaultAgent);
  const [startModes, setStartModes] = useState<Record<AgentProvider, string>>(() => ({
    claude: readStartMode('claude'),
    codex: readStartMode('codex'),
  }));
  const layoutRef = useRef<HTMLElement>(null);
  const centralRef = useRef<HTMLElement>(null);
  const [sidebarWidth, setSidebarWidth] = usePanelSize(
    'galeata:sidebar-width',
    sidebarDefault,
    sidebarBounds,
  );
  const [planWidth, setPlanWidth] = usePanelSize('galeata:plan-width', planDefault, planBounds);
  const [codeWidth, setCodeWidth] = usePanelSize('galeata:code-width', codeDefault, codeBounds);
  const [bottomHeight, setBottomHeight] = usePanelSize(
    'galeata:bottom-height',
    bottomDefault,
    bottomBounds,
  );
  // Space left for a side panel once the conversation keeps its minimum width.
  const sideRoom = (other: number) =>
    (layoutRef.current?.clientWidth ?? Infinity) - 55 - other - editorMinWidth;
  const planShown = planVisible && !!workspace;
  const reviewing = panel === 'git' && !!workspace;
  const filesPage = panel === 'files' && !!workspace;
  const agentPage = panel === 'agents' || panel === 'settings';
  const codeShown = codeVisible && !!workspace && !reviewing && !filesPage;
  function navigate(next: Panel) {
    setCodeVisible(false);
    if (next === 'files') setDiff(null);
    setPanel(next);
  }
  const [bottom, setBottom] = useState<Bottom>('terminal');
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const [terminalKey, setTerminalKey] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [query, setQuery] = useState('');
  const [searchFiles, setSearchFiles] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchNext, setSearchNext] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const searchKey = `${workspace?.id}:${searchFiles}:${query}`;
  const searchKeyRef = useRef(searchKey);
  searchKeyRef.current = searchKey;
  const [commitMessage, setCommitMessage] = useState('');
  const [gitManager, setGitManager] = useState<GitTab | null>(null);
  const gitRunning = useRef(false);
  const [mcpConfig, setMcpConfig] = useState<Record<string, unknown> | null>(null);
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
    if (!expected) return;
    const results = await Promise.allSettled([
      request<Plan>('plan.get'),
      request<GitStatus>('git.status'),
      request<Activity[]>('activity.list'),
    ]);
    if (getActiveWorkspace()?.id !== expected) return;
    const [p, g, a] = results;
    if (p.status === 'fulfilled') setPlan(p.value);
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
    async (path: string, targetLine?: number, reveal = true) => {
      setDiff(null);
      setLine(targetLine);
      if (reveal) { setCodeVisible(true); mascot.react('file-opened'); }
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
        setTabs((previous) =>
          previous.some((file) => file.path === path)
            ? previous
            : [
                ...previous,
                {
                  path,
                  content: result.content,
                  savedContent: result.content,
                  stamp: result.stamp,
                  language: languageFor(path),
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
          setCodeVisible(true);
      } catch (e) {
        error(e);
      }
    },
    [error],
  );

  const chooseWorkspace = useCallback(
    async (path?: string) => {
      setBusy('Ouverture du projet…');
      try {
        const result = await openWorkspace(path);
        if (!result) return;
        setWorkspace(result);
        setTabs([]);
        setActive('');
        setDiff(null);
        setSessions([]);
        setProviders([]);
        setActivities([]);
        setPlan(initialPlan);
        setTerminals([]);
        agentStore.clear();
          setMcpConfig(null);
        setHits([]);
        setTreeRevision((value) => value + 1);
        await refresh();
        void loadSessions();
        void request<{ openFiles?: string[]; activeFile?: string } | null>('preferences.get')
          .then(async (layout) => {
            if (layout?.openFiles?.length) {
              for (const file of layout.openFiles.slice(0, 20))
                await openFile(file, undefined, false);
              if (layout.activeFile) setActive(layout.activeFile);
            } else if (!desktop) await openFile('README.md', undefined, false);
          })
          .catch(error);
      } catch (e) {
        error(e);
      } finally {
        setBusy('');
      }
    },
    [error, refresh, loadSessions, openFile],
  );

  function openPreferences() {
    setPanel('settings');
    // Modes chosen in conversations are remembered: show the current values.
    setStartModes({ claude: readStartMode('claude'), codex: readStartMode('codex') });
    if (workspace)
      void request<Record<string, unknown>>('mcp.config').then(setMcpConfig).catch(error);
  }

  function openFolder() {
    if (tabs.some((file) => file.content !== file.savedContent)) {
      setDialog({
        title: 'Changer de projet',
        description:
          'Certains fichiers contiennent des modifications non enregistrées. En continuant, vous abandonnez ces modifications.',
        fields: [],
        submit: 'Abandonner et ouvrir',
        danger: true,
        onSubmit: async () => {
          await chooseWorkspace();
        },
      });
    } else void chooseWorkspace();
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
  useEffect(() => {
    if (!workspace) return;
    const timer = setTimeout(() => {
      void request('preferences.save', {
        openFiles: tabs.map((file) => file.path),
        activeFile: active,
      }).catch(error);
    }, 600);
    return () => clearTimeout(timer);
  }, [workspace, tabs, active, error]);

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
    void register('plan:changed', changed).catch(error);
    void register('activity:changed', changed).catch(error);
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
  }, [workspace, refresh, error, showDiff, openFile]);

  useEffect(() => {
    if (!workspace || !active) return;
    let disposed = false;
    async function check() {
      const previous = tabsRef.current.find((file) => file.path === active);
      if (!previous) return;
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

  async function saveFile(path: string) {
    const file = tabsRef.current.find((file) => file.path === path);
    if (!file || file.content === file.savedContent) return;
    try {
      const result = await request<{ stamp: string }>('workspace.write', {
        path,
        content: file.content,
        stamp: file.stamp,
      });
      setTabs((previous) =>
        previous.map((current) =>
          current.path === path
            ? { ...current, stamp: result.stamp, savedContent: file.content, external: false }
            : current,
        ),
      );
      await refresh();
    } catch (e) {
      error(e);
      throw e;
    }
  }
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
  async function savePlan(next: Plan) {
    try {
      const result = await request<Plan>('plan.save', { revision: next.revision, plan: next });
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
      .filter((c) => c.state !== 'exited')
      .at(-1);
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
    void request<Plan>('plan.update_step', { id: step.id, status, revision: plan.revision })
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
        searchFiles ? 'workspace.search_files' : 'workspace.search_text',
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
  }, [query, searchFiles, workspace, error]);
  async function loadMoreSearch() {
    if (searchNext === null || searching) return;
    const expected = searchKeyRef.current;
    setSearching(true);
    try {
      const result = await request<{ items: SearchHit[]; nextOffset: number | null }>(
        searchFiles ? 'workspace.search_files' : 'workspace.search_text',
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
    if (!palette || !paletteQuery.trim() || !workspace) {
      setPaletteHits([]);
      return;
    }
    let cancelled = false;
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
  }, [palette, paletteQuery, workspace, error]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPalette((value) => !value);
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (active) void saveFile(active).catch(() => {});
      }
      if (event.key === '`') {
        event.preventDefault();
        setBottomVisible((value) => !value);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
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

  function saveHandoff() {
    setDialog({
      title: 'Préparer la reprise',
      fields: [
        {
          name: 'message',
          label: 'Travail effectué et décisions',
          type: 'textarea',
          required: true,
        },
        { name: 'nextAction', label: 'Prochaine action', required: true },
        { name: 'sessionId', label: 'Identifiant de session (facultatif)' },
      ],
      onSubmit: async (values) => {
        await request('session.save_handoff', values);
        await refresh();
      },
    });
  }
  function runVerification() {
    setDialog({
      title: 'Exécuter une vérification',
      description:
        'La commande est exécutée dans ce projet, sans shell intermédiaire. Durée maximale : 120 secondes. Son code de sortie et ses sorties seront enregistrés.',
      fields: [
        { name: 'program', label: 'Programme', value: 'npm', required: true },
        { name: 'args', label: 'Arguments (tableau JSON)', value: '["test"]', required: true },
        {
          name: 'stepId',
          label: 'Étape associée',
          options: [
            { value: '', label: 'Aucune étape' },
            ...plan.steps.map((step) => ({ value: step.id, label: step.title })),
          ],
        },
      ],
      submit: 'Exécuter',
      onSubmit: async (values) => {
        const args: unknown = JSON.parse(values.args);
        if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string'))
          throw new Error('Utilisez un tableau JSON de chaînes, par exemple ["test"].');
        await request('verification.run', { program: values.program, args, stepId: values.stepId });
        await refresh();
        setBottom('checks');
        setBottomVisible(true);
      },
    });
  }
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
  const currentAgentEvents = activities
    .filter((event) => event.kind === 'activity' && event.data.sessionId)
    .filter(
      (event, index, all) =>
        all.findIndex((other) => other.data.sessionId === event.data.sessionId) === index,
    );
  const activeCount = currentAgentEvents.filter((event) => event.data.status === 'running').length;
  const overlappingFiles = new Set<string>();
  const claimed = new Map<string, string>();
  for (const event of currentAgentEvents.filter((event) => event.data.status === 'running'))
    for (const file of Array.isArray(event.data.files) ? event.data.files : [])
      if (typeof file === 'string') {
        if (claimed.has(file) && claimed.get(file) !== event.data.sessionId)
          overlappingFiles.add(file);
        claimed.set(file, String(event.data.sessionId));
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

  // Shared editor: central in Files/Git, beside conversations and search results.
  const codeArea = (
    <>
      <div className="editor-tabs">
        <div className="tab-list" role="tablist" aria-label="Fichiers ouverts">
          {(reviewing ? [] : tabs).map((file) => (
            <div
              key={file.path}
              className={`editor-tab ${active === file.path && !diff ? 'active' : ''}`}
            >
              <button
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
                  {file.path.endsWith('.md') ? 'M↓' : file.path.endsWith('.rs') ? 'Rs' : '✳'}
                </span>
                {file.path.split('/').pop()}
                {file.content !== file.savedContent ? <span className="dirty-dot" /> : null}
              </button>
              <button
                className="tab-close"
                aria-label={`Fermer ${file.path}`}
                onClick={() => closeTab(file.path)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          {diff ? (
            <div className="editor-tab active">
              <button role="tab" aria-selected="true">
                <Icon name="git" size={13} />
                {diff.path.split('/').pop()} · {diff.staged ? 'indexé' : 'diff'}
                {diff.editable && activeFile?.path === diff.path && activeFile.content !== activeFile.savedContent ? <span className="dirty-dot" /> : null}
              </button>
              <button
                className="tab-close"
                aria-label="Fermer le diff"
                onClick={() => setDiff(null)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ) : null}
          {!tabs.length && !diff ? <span className="empty-tab">Bienvenue dans Galeata</span> : null}
        </div>
        <div className="editor-tab-actions">
          {reviewing || filesPage ? null : (
            <button
              className="icon-button"
              title="Fermer le volet de code"
              aria-label="Fermer le volet de code"
              onClick={() => setCodeVisible(false)}
            >
              <Icon name="close" size={14} />
            </button>
          )}
          <button
            className="icon-button"
            title="Enregistrer le fichier"
            aria-label="Enregistrer le fichier"
            disabled={!activeFile || (!!diff && !editorDiff?.editable)}
            onClick={() => void saveFile(active).catch(() => {})}
          >
            <Icon name="save" size={14} />
          </button>
          <button
            className="icon-button"
            title="Renommer le fichier"
            aria-label="Renommer le fichier"
            disabled={!activeFile}
            onClick={() => fileAction('rename')}
          >
            <Icon name="edit" size={14} />
          </button>
          <button
            className="icon-button"
            title="Supprimer le fichier"
            aria-label="Supprimer le fichier"
            disabled={!activeFile}
            onClick={() => fileAction('delete')}
          >
            <Icon name="trash" size={14} />
          </button>
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
            <span className="editor-language">{displayFile.language}</span>
          </div>
          {activeFile?.external && !diff ? (
            <div className="conflict-banner">
              <Icon name="warning" size={15} />
              <span>Ce fichier a changé sur disque. Vos modifications sont conservées.</span>
              <button
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
              </button>
              <button
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
              </button>
            </div>
          ) : null}
          <Suspense fallback={<div className="loading-editor">Préparation de l’éditeur…</div>}>
            <EditorSurface
              key={`${workspace?.id}:${displayFile.path}:${diff ? 'diff' : 'edit'}:${diff?.original ?? ''}`}
              file={displayFile}
              diff={editorDiff}
              line={line}
              onChange={(content) => {
                mascot.react('text-edit');
                setTabs((previous) =>
                  previous.map((file) => (file.path === active ? { ...file, content } : file)),
                );
              }}
              onSave={() => void saveFile(active).catch(() => {})}
            />
          </Suspense>
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
                <button className="button" onClick={() => void showDiff(git.files[0].path)}>
                  Relire {git.files[0].path}
                </button>
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
          <img src="/galeata-logo.svg" alt="Galeata" />
        </div>
        <div className="topbar-divider" />
        <button className="workspace-picker" onClick={openFolder}>
          <Icon name="folder" size={15} />
          <span>{workspace?.name ?? 'Ouvrir un projet'}</span>
          <Icon name="chevron" size={12} className="rotated" />
        </button>
        <button className="command-trigger" onClick={() => setPalette(true)}>
          <Icon name="search" size={14} />
          <span>Rechercher un fichier ou une action…</span>
          <kbd>Ctrl P</kbd>
        </button>
        <div className="topbar-actions">
          {!desktop ? (
            <span className="preview-badge">APERÇU INTERFACE</span>
          ) : (
            <span className="local-badge">
              <span className="status-dot" /> Local
            </span>
          )}
          {!filesPage && !reviewing ? (
          <button
            className={`icon-button ${codeVisible ? 'active' : ''}`}
            title="Afficher ou masquer le code"
            aria-label="Afficher ou masquer le code"
            aria-pressed={codeVisible}
            onClick={() => setCodeVisible((value) => !value)}
          >
            <Icon name="files" />
          </button>
          ) : null}
          <button
            className={`icon-button ${planVisible ? 'active' : ''}`}
            title="Afficher ou masquer le plan"
            aria-label="Afficher ou masquer le plan"
            onClick={() => setPlanVisible((value) => !value)}
          >
            <Icon name="panel" />
          </button>
        </div>
      </header>
      <main className="workspace-layout" ref={layoutRef}>
        <nav className="activity-rail" aria-label="Navigation principale">
          <div>
            {navigation.map((item) => (
              <button
                key={item.id}
                className={`rail-button ${panel === item.id ? 'active' : ''}`}
                title={item.label}
                aria-label={item.label}
                aria-pressed={panel === item.id}
                onClick={() => navigate(item.id)}
              >
                <Icon name={item.icon} size={21} />
                {item.id === 'git' && git.files.length ? (
                  <span className="rail-count">{git.files.length}</span>
                ) : item.id === 'agents' && activeCount ? (
                  <span className="rail-count">{activeCount}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div>
            <button
              className="rail-button"
              title="Historique"
              aria-label="Historique"
              onClick={() => {
                setBottom('activity');
                setBottomVisible(true);
              }}
            >
              <Icon name="history" size={21} />
            </button>
            <button
              className={`rail-button ${panel === 'settings' ? 'active' : ''}`}
              aria-label="Préférences"
              title="Préférences"
              onClick={openPreferences}
            >
              <Icon name="settings" size={21} />
            </button>
            <TurtleMascot compact agentId={mascotAgent || undefined} />
          </div>
        </nav>
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="panel-heading">
            <span>{panelNames[panel]}</span>
            <button
              className="icon-button"
              aria-label="Actualiser"
              title="Actualiser"
              disabled={!workspace}
              onClick={() => {
                void refresh();
                setTreeRevision((value) => value + 1);
                if (panel === 'agents') void loadSessions();
              }}
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>
          {!workspace ? (
            <div className="sidebar-empty">
              <Icon name="folder" size={25} />
              <p>Votre prochain projet commence ici.</p>
              <button className="button small" onClick={openFolder}>
                Ouvrir un dossier
              </button>
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
                      <button
                        className="icon-button"
                        title="Nouveau fichier"
                        aria-label="Nouveau fichier"
                        onClick={() => fileAction('create')}
                      >
                        <Icon name="plus" size={14} />
                      </button>
                      <button
                        className="icon-button"
                        title="Nouveau dossier"
                        aria-label="Nouveau dossier"
                        onClick={() => fileAction('create', true)}
                      >
                        <Icon name="folder" size={14} />
                      </button>
                    </div>
                  </div>
                  <FileTree
                    workspaceId={workspace.id}
                    revision={treeRevision}
                    selected={active}
                    onOpen={(path) => void openFile(path)}
                    onError={error}
                  />
                </>
              ) : null}
              {panel === 'search' ? (
                <div className="sidebar-content search-sidebar">
                  <span className="eyebrow">RECHERCHE LOCALE</span>
                  <h3>Tout le projet, un seul endroit.</h3>
                  <p className="small-copy muted">Recherchez dans le contenu ou les noms de fichiers depuis la page centrale.</p>
                  <div className="section-line"><h3>Résultats</h3><span className="count">{hits.length}</span></div>
                  <p className="small-copy muted">{query.trim() ? `Recherche : « ${query} »` : 'Saisissez un terme pour commencer.'}</p>
                  <p className="small-copy muted">Un clic ouvre le fichier à côté des résultats, à la ligne choisie.</p>
                </div>
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
                        <span className="count">{git.files.length}</span>
                      </div>
                      <button className="sidebar-action" onClick={() => setGitManager('branches')}><Icon name="branch" size={15} /> Branches et synchronisation</button>
                      <button className="sidebar-action" onClick={() => setGitManager('stashes')}><Icon name="history" size={15} /> Mettre de côté / restaurer</button>
                      {git.merging || git.files.some((file) => file.conflicted) ? <div className="git-notice"><strong>{git.merging ? 'Fusion en cours' : 'Conflits à résoudre'}</strong><p>Corrigez les fichiers en conflit, puis indexez-les.</p><button className="text-button" onClick={() => setGitManager('branches')}>Suivre la résolution</button></div> : null}
                      <textarea
                        className="commit-input"
                        aria-label="Message de commit"
                        placeholder="Décrire les changements…"
                        rows={3}
                        value={commitMessage}
                        onChange={(event) => setCommitMessage(event.target.value)}
                      />
                      <button
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
                      </button>
                      <div className="section-line">
                        <h3>Changements</h3>
                        <span className="count">{git.files.length}</span>
                      </div>
                      {git.files.map((file) => (
                        <div className="git-file" key={file.path}>
                          <button
                            className="truncate"
                            title={`Diff non indexé : ${file.path}`}
                            onClick={() => void showDiff(file.path, false)}
                          >
                            <span className={`git-status-letter ${file.conflicted ? 'conflicted' : ''}`}>
                              {file.worktree === ' ' ? file.index : file.worktree}
                            </span>
                            {file.path}
                          </button>
                          {file.index !== ' ' && file.index !== '?' ? (
                            <>
                              <button
                                className="icon-button"
                                title="Voir le diff indexé"
                                aria-label={`Diff indexé ${file.path}`}
                                onClick={() => void showDiff(file.path, true)}
                              >
                                <Icon name="files" size={13} />
                              </button>
                              <button
                                className="icon-button"
                                title="Désindexer"
                                aria-label={`Désindexer ${file.path}`}
                                onClick={() =>
                                  void mutateGit('unstage', { path: file.path }).catch(() => {})
                                }
                              >
                                −
                              </button>
                            </>
                          ) : null}
                          <button
                            className="icon-button"
                            title="Indexer"
                            aria-label={`Indexer ${file.path}`}
                            onClick={() =>
                              void mutateGit('stage', { path: file.path }).catch(() => {})
                            }
                          >
                            <Icon name="plus" size={13} />
                          </button>
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
                      <button className="sidebar-action" onClick={() => setGitManager('branches')}>
                        <Icon name="branch" size={15} />
                        Créer une branche
                      </button>
                      <button className="sidebar-action" onClick={() => gitDialog('worktree')}>
                        <Icon name="folder" size={15} />
                        Créer un worktree
                      </button>
                      <button
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
                      </button>
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
              {panel === 'agents' ? (
                <div className="sidebar-content">
                  <p className="section-caption">VOS OUTILS, VOTRE ENVIRONNEMENT</p>
                  {['codex', 'claude'].map((id) => {
                    const provider = providers.find((value) => value.id === id);
                    return (
                      <div className="provider-card" key={id}>
                        <div className="provider-logo">{id === 'codex' ? '⌘' : '✳'}</div>
                        <div>
                          <strong>{id === 'codex' ? 'Codex' : 'Claude Code'}</strong>
                          <span title={provider?.error ?? undefined}>
                            {provider?.available
                              ? provider.version || 'Installé'
                              : !desktop
                                ? 'Application de bureau requise'
                                : provider?.error
                                  ? 'Installé mais impossible à lancer'
                                  : providers.length
                                    ? 'Non installé'
                                    : 'Détection…'}
                          </span>
                        </div>
                        <button
                          className="icon-button"
                          title="Nouvelle conversation"
                          aria-label={`Nouvelle conversation ${id}`}
                          disabled={!provider?.available}
                          onClick={() => void startAgent(id as AgentProvider).catch(error)}
                        >
                          <Icon name="play" size={14} />
                        </button>
                        <button
                          className="icon-button"
                          title="Ouvrir dans le terminal (interface d’origine)"
                          aria-label={`Ouvrir ${id} dans le terminal`}
                          disabled={!provider?.available}
                          onClick={() => launchAgent(id)}
                        >
                          <Icon name="terminal" size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <p className="section-caption">ACTIVITÉ DÉCLARÉE VIA MCP</p>
                  {currentAgentEvents.map((event) => (
                    <article className="agent-card" key={event.id}>
                      <span
                        className={`status-dot ${event.data.status === 'blocked' ? 'warning' : event.data.status === 'done' ? 'idle' : ''}`}
                      />
                      <div>
                        <strong>{String(event.data.sessionId).slice(0, 12)}</strong>
                        <p>{event.message}</p>
                        <small>
                          {relativeTime(event.createdAt)} · {String(event.data.status)}
                        </small>
                        {event.data.parentId ? (
                          <small>Sous-agent de {String(event.data.parentId).slice(0, 12)}</small>
                        ) : null}
                      </div>
                    </article>
                  ))}
                  {!currentAgentEvents.length ? (
                    <p className="muted small-copy">
                      Les agents apparaissent ici lorsqu’ils déclarent leur mission via le MCP.
                      Aucun état d’activité n’est déduit du terminal.
                    </p>
                  ) : null}
                  {overlappingFiles.size ? (
                    <div className="inline-error">
                      <Icon name="warning" size={14} />
                      Chevauchement déclaré : {[...overlappingFiles].join(', ')}
                    </div>
                  ) : null}
                  <div className="section-line">
                    <h3>Reprendre une session</h3>
                    <span className="count">{sessions.length}</span>
                  </div>
                  {sessions.map((session) => (
                    <article className="session-card" key={`${session.provider}:${session.id}`}>
                      <div className="session-provider">
                        {session.provider === 'codex' ? 'CODEX' : 'CLAUDE CODE'}
                        <span>{relativeTime(session.modifiedAt)}</span>
                      </div>
                      <strong>{session.title}</strong>
                      {session.summary ||
                      activities.find(
                        (event) => event.kind === 'handoff' && event.data.sessionId === session.id,
                      )?.message ? (
                        <p>
                          {session.summary ||
                            activities.find(
                              (event) =>
                                event.kind === 'handoff' && event.data.sessionId === session.id,
                            )?.message}
                        </p>
                      ) : session.description ? (
                        <p>{session.description}</p>
                      ) : null}
                      {session.branch ? <small>Branche {session.branch}</small> : null}
                      {session.parentId ? (
                        <small>Sous-agent · parent {session.parentId.slice(0, 8)}</small>
                      ) : null}
                      <button
                        className="text-button"
                        disabled={
                          !providers.find((provider) => provider.id === session.provider)?.available
                        }
                        onClick={() => void startAgent(session.provider, session.id).catch(error)}
                      >
                        Reprendre <Icon name="arrow" size={13} />
                      </button>
                    </article>
                  ))}
                  {!sessions.length ? (
                    <p className="muted small-copy">Aucune session découverte pour ce dossier.</p>
                  ) : null}
                  <button className="sidebar-action" onClick={saveHandoff}>
                    <Icon name="history" size={15} />
                    Enregistrer une passation
                  </button>
                </div>
              ) : null}
              {panel === 'settings' ? (
                <div className="sidebar-content">
                  <p className="section-caption">GALEATA 0.1.0 · LINUX</p>
                  <h3>Un espace local</h3>
                  <p className="small-copy muted">
                    Plans et historique restent sur votre machine. Aucun compte Galeata ni
                    télémétrie.
                  </p>
                  <div className="section-line">
                    <h3>Agent par défaut</h3>
                  </div>
                  <p className="small-copy muted">
                    Lancé par le bouton « + » des conversations. Si celui-ci n’est pas installé,
                    l’autre est utilisé.
                  </p>
                  <div className="segmented" role="radiogroup" aria-label="Agent par défaut">
                    {(['claude', 'codex'] as AgentProvider[]).map((id) => {
                      const info = providers.find((provider) => provider.id === id);
                      return (
                        <button
                          key={id}
                          role="radio"
                          aria-checked={defaultAgent === id}
                          className={defaultAgent === id ? 'active' : ''}
                          title={info?.error ?? undefined}
                          onClick={() => {
                            setDefaultAgent(id);
                            writeDefaultAgent(id);
                          }}
                        >
                          {providerNames[id]}
                          {desktop && info && !info.available ? ' · indisponible' : ''}
                        </button>
                      );
                    })}
                  </div>
                  {(['claude', 'codex'] as AgentProvider[]).map((agentId) => (
                    <div key={agentId}>
                      <div className="section-line">
                        <h3>Mode de {providerNames[agentId]} au démarrage</h3>
                      </div>
                      <div
                        className="segmented"
                        role="radiogroup"
                        aria-label={`Mode de ${providerNames[agentId]} au démarrage`}
                      >
                        {agentModes[agentId].map((mode) => (
                          <button
                            key={mode.id}
                            role="radio"
                            aria-checked={startModes[agentId] === mode.id}
                            className={`${startModes[agentId] === mode.id ? 'active' : ''} ${mode.danger ? 'danger' : ''}`}
                            title={mode.hint}
                            onClick={() => {
                              setStartModes((previous) => ({ ...previous, [agentId]: mode.id }));
                              writeStartMode(agentId, mode.id);
                            }}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="small-copy muted">
                    Le dernier mode choisi dans une conversation (sélecteur ou Maj+Tab) devient
                    celui des prochaines.
                  </p>
                  <div className="section-line">
                    <h3>MCP interne</h3>
                    <Icon name="link" size={15} />
                  </div>
                  <p className="small-copy muted">
                    Les agents lancés ici reçoivent une configuration MCP pour ce projet lorsque le
                    binaire galeata-mcp est disponible.
                  </p>
                  <button
                    className="sidebar-action"
                    onClick={() =>
                      void request<Record<string, unknown>>('mcp.config')
                        .then(setMcpConfig)
                        .catch(error)
                    }
                  >
                    <Icon name="refresh" size={14} />
                    Afficher la configuration
                  </button>
                  {mcpConfig ? (
                    <pre className="config-code">{JSON.stringify(mcpConfig, null, 2)}</pre>
                  ) : null}
                  <div className="section-line">
                    <h3>Raccourcis</h3>
                  </div>
                  <div className="shortcut-row">
                    <span>Fichier / action</span>
                    <kbd>Ctrl P</kbd>
                  </div>
                  <div className="shortcut-row">
                    <span>Enregistrer</span>
                    <kbd>Ctrl S</kbd>
                  </div>
                  <div className="shortcut-row">
                    <span>Terminal</span>
                    <kbd>Ctrl `</kbd>
                  </div>
                  <button
                    className="sidebar-action"
                    onClick={() => setPlanVisible((value) => !value)}
                  >
                    <Icon name="panel" size={15} />
                    {planVisible ? 'Replier' : 'Afficher'} le plan
                  </button>
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
                sideRoom((planShown ? planWidth : 0) + (codeShown && !reviewing ? codeWidth : 0)),
              ),
            )
          }
          onReset={() => setSidebarWidth(sidebarDefault)}
        />
        <section className="central-workspace" aria-label="Espace de travail" ref={centralRef}>
          {workspace ? (
            <div className="agent-layer" hidden={!agentPage}>
              <AgentWorkspace
                providers={providers}
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
                onFind={() => { setPaletteQuery(''); setPalette(true); }}
                onCreate={() => fileAction('create')} onOpen={(path) => void openFile(path)} />}
            </section>
          ) : null}
          {workspace && panel === 'search' ? (
            <section className="search-area" aria-label="Recherche dans le projet">
              <SearchPage query={query} filesOnly={searchFiles} hits={hits} searching={searching}
                hasMore={searchNext !== null} onQuery={setQuery} onFilesOnly={setSearchFiles}
                onOpen={(hit) => void openFile(hit.path, hit.line || undefined)} onMore={() => void loadMoreSearch()} />
            </section>
          ) : null}
          {reviewing ? (
            <section className="review-area" aria-label="Relecture du code">
              <GitToolbar git={git} busy={!!busy} onManage={setGitManager}
                onMutate={(action) => void mutateGit(action).catch(() => {})} />
              {diff ? <>
                <div className="diff-page-toolbar">
                  <button className="text-button" onClick={() => setDiff(null)}><Icon name="git" size={15} /> Vue d’ensemble</button>
                  <span>{diff.staged ? 'HEAD → Index' : 'Index → Fichier de travail'}</span>
                  <button className="text-button" onClick={() => { navigate('files'); void openFile(diff.path); }}>Ouvrir le fichier <Icon name="arrow" size={14} /></button>
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
                <button className="button" onClick={openFolder}>
                  <Icon name="folder" size={16} />
                  Ouvrir un dossier
                  <Icon name="arrow" size={15} />
                </button>
                {desktop && localStorage.getItem('galeata:last-workspace') ? (
                  <button
                    className="text-button"
                    onClick={() =>
                      void chooseWorkspace(
                        localStorage.getItem('galeata:last-workspace') ?? undefined,
                      )
                    }
                  >
                    Reprendre le dernier projet
                  </button>
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
                    <button
                      key={item.id}
                      role="tab"
                      aria-selected={bottom === item.id}
                      className={bottom === item.id ? 'active' : ''}
                      onClick={() => setBottom(item.id)}
                    >
                      <Icon name={item.icon} size={13} />
                      {item.label}
                      {item.id === 'activity' && activities.length ? (
                        <span className="count">{activities.length}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div>
                  <button
                    className="icon-button"
                    title="Nouveau terminal"
                    aria-label="Nouveau terminal"
                    disabled={!workspace || !desktop}
                    onClick={() => launchAgent('shell')}
                  >
                    <Icon name="plus" size={14} />
                  </button>
                  <button
                    className="icon-button"
                    title="Masquer le terminal"
                    aria-label="Masquer le terminal"
                    onClick={() => setBottomVisible(false)}
                  >
                    <Icon name="close" size={14} />
                  </button>
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
                          <button onClick={() => setTerminalKey(tab.launch.key)}>
                            <span className={`status-dot ${tab.exited ? 'idle' : ''}`} />
                            {tab.launch.kind}
                            {tab.exited ? ' · terminé' : ''}
                          </button>
                          <button
                            aria-label={`Fermer le terminal ${tab.launch.kind}`}
                            onClick={() => closeTerminal(tab.launch.key)}
                          >
                            <Icon name="close" size={11} />
                          </button>
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
                      <span className="prompt-symbol">❯</span>
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
                      <button className="text-button" onClick={() => launchAgent('shell')}>
                        Ouvrir un terminal <Icon name="plus" size={13} />
                      </button>
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
        {codeShown && !reviewing ? (
          <Splitter
            label="Largeur du volet de code"
            orientation="vertical"
            size={codeWidth}
            bounds={codeBounds}
            direction={-1}
            onResize={(size) =>
              setCodeWidth(Math.min(size, sideRoom(sidebarWidth + (planShown ? planWidth : 0))))
            }
            onReset={() => setCodeWidth(codeDefault)}
          />
        ) : null}
        {codeShown && !reviewing ? (
          <section className="code-panel" aria-label="Volet de code" style={{ width: codeWidth }}>
            {codeArea}
          </section>
        ) : null}
        {planVisible && workspace ? (
          <Splitter
            label="Largeur du plan"
            orientation="vertical"
            size={planWidth}
            bounds={planBounds}
            direction={-1}
            onResize={(size) =>
              setPlanWidth(
                Math.min(size, sideRoom(sidebarWidth + (codeShown && !reviewing ? codeWidth : 0))),
              )
            }
            onReset={() => setPlanWidth(planDefault)}
          />
        ) : null}
        {planVisible && workspace ? (
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
      {gitManager && workspace ? <GitManager key={workspace.id} workspaceId={workspace.id} git={git}
        initialTab={gitManager} busy={!!busy} dirty={tabs.some((file) => file.content !== file.savedContent)}
        onClose={() => setGitManager(null)} onMutate={mutateGit} /> : null}
      <footer className="statusbar">
        <div>
          {git.isRepo ? (
            <button aria-label={`Gérer les branches : ${git.branch}`} title="Changer de branche, fusionner et gérer les stash" onClick={() => setGitManager('branches')}>
              <Icon name="branch" size={12} />
              {git.branch}
            </button>
          ) : (
            <span>
              <Icon name="folder" size={12} />
              {workspace ? 'Dossier local' : 'Aucun projet'}
            </span>
          )}
          <button onClick={() => navigate('agents')}>
            <Icon name="agents" size={12} />
            {activeCount ? `${activeCount} agent(s) déclaré(s) actif(s)` : 'Agents au repos'}
          </button>
          <button
            title="Exécuter une vérification"
            disabled={!workspace || !desktop}
            onClick={runVerification}
          >
            <Icon name="check" size={12} />
            Vérifier
          </button>
        </div>
        <div>
          <span className="status-message">
            {busy ||
              (desktop ? 'Tout reste sur votre machine' : 'Démonstration · fichiers d’exemple')}
          </span>
          {activeFile ? (
            <>
              <span>UTF-8</span>
              <span>{activeFile.language}</span>
            </>
          ) : null}
          <button
            aria-label="Afficher le terminal"
            title="Afficher le terminal"
            onClick={() => setBottomVisible((value) => !value)}
          >
            <Icon name="terminal" size={13} />
          </button>
          <span className="status-dot" />
        </div>
      </footer>
      {toast ? (
        <div className="toast" role="alert">
          <Icon name="warning" size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Fermer le message"
            onClick={() => setToast('')}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}
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
            }}
          >
            <div className="palette-input">
              <Icon name="search" />
              <input
                autoFocus
                aria-label="Fichier ou action"
                placeholder="Rechercher un fichier ou choisir une action…"
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="palette-results">
              {paletteQuery ? (
                paletteHits.map((hit) => (
                  <button
                    key={hit.path}
                    onClick={() => {
                      void openFile(hit.path);
                      setPalette(false);
                      setPaletteQuery('');
                    }}
                  >
                    <Icon name="files" size={15} />
                    {hit.path}
                  </button>
                ))
              ) : (
                <>
                  <button
                    onClick={() => {
                      setPalette(false);
                      openFolder();
                    }}
                  >
                    <Icon name="folder" size={16} />
                    Ouvrir un dossier
                  </button>
                  <button
                    disabled={!workspace}
                    onClick={() => {
                      setPalette(false);
                      fileAction('create');
                    }}
                  >
                    <Icon name="plus" size={16} />
                    Créer un fichier
                  </button>
                  <button
                    disabled={!workspace || !desktop}
                    onClick={() => {
                      setPalette(false);
                      launchAgent('shell');
                    }}
                  >
                    <Icon name="terminal" size={16} />
                    Ouvrir un terminal
                  </button>
                  <button
                    onClick={() => {
                      setPalette(false);
                      setPanel('agents');
                    }}
                  >
                    <Icon name="agents" size={16} />
                    Voir les agents et les sessions
                  </button>
                  <button
                    onClick={() => {
                      setPalette(false);
                      setPlanVisible((value) => !value);
                    }}
                  >
                    <Icon name="plan" size={16} />
                    Afficher ou replier le plan
                  </button>
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

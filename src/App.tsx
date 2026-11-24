import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { desktop, getActiveWorkspace, openWorkspace, request, subscribe } from './api.ts';
import { languageFor, relativeTime } from './domain.ts';
import type { Activity, GitStatus, OpenFile, Plan, Provider, RemoteConnection, RemoteDetail, RemoteItem, SearchHit, Session, Step, Workspace } from './types.ts';
import { Icon } from './components/Icon.tsx';
import { FileTree } from './components/FileTree.tsx';
import PlanPanel from './components/PlanPanel.tsx';
import Dialog, { type DialogSpec } from './components/Dialog.tsx';
import type { TerminalLaunch } from './components/TerminalView.tsx';

const EditorSurface = lazy(() => import('./components/EditorSurface.tsx').catch(() => import('./components/SimpleEditor.tsx')));
const TerminalView = lazy(() => import('./components/TerminalView.tsx'));
const initialPlan: Plan = { revision: 0, objective: '', steps: [] };
type Panel = 'files' | 'search' | 'git' | 'agents' | 'remote' | 'settings';
type Bottom = 'terminal' | 'activity' | 'checks';
interface TerminalTab { launch: TerminalLaunch; id?: string; exited?: boolean; }
const panelNames: Record<Panel, string> = { files: 'Explorateur', search: 'Recherche', git: 'Contrôle de source', agents: 'Agents & sessions', remote: 'GitHub & GitLab', settings: 'Préférences' };
const navigation: { id: Panel; icon: string; label: string }[] = [
  { id: 'files', icon: 'files', label: 'Fichiers' }, { id: 'search', icon: 'search', label: 'Rechercher' }, { id: 'git', icon: 'git', label: 'Git' }, { id: 'agents', icon: 'agents', label: 'Agents et sessions' }, { id: 'remote', icon: 'cloud', label: 'GitHub et GitLab' },
];

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [panel, setPanel] = useState<Panel>('files');
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [git, setGit] = useState<GitStatus>({ branch: '', isRepo: false, files: [] });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tabs, setTabs] = useState<OpenFile[]>([]);
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const [active, setActive] = useState('');
  const [line, setLine] = useState<number>();
  const [diff, setDiff] = useState<{ path: string; original: string; modified: string; staged: boolean } | null>(null);
  const [treeRevision, setTreeRevision] = useState(0);
  const [planVisible, setPlanVisible] = useState(() => localStorage.getItem('galeata:plan-visible') !== 'false');
  const [bottomVisible, setBottomVisible] = useState(true);
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
  const [commitMessage, setCommitMessage] = useState('');
  const [connection, setConnection] = useState<RemoteConnection | null>(null);
  const [remoteItems, setRemoteItems] = useState<RemoteItem[]>([]);
  const [remoteDetail, setRemoteDetail] = useState<{ item: RemoteItem; detail: RemoteDetail } | null>(null);
  const [mcpConfig, setMcpConfig] = useState<Record<string, unknown> | null>(null);
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteHits, setPaletteHits] = useState<SearchHit[]>([]);
  const activeFile = tabs.find(file => file.path === active);
  const error = useCallback((value: unknown) => setToast(String(value).replace(/^Error: /, '')), []);

  const refresh = useCallback(async () => {
    const expected = getActiveWorkspace()?.id; if (!expected) return;
    const results = await Promise.allSettled([request<Plan>('plan.get'), request<GitStatus>('git.status'), request<Activity[]>('activity.list')]);
    if (getActiveWorkspace()?.id !== expected) return;
    const [p, g, a] = results;
    if (p.status === 'fulfilled') setPlan(p.value); else error(p.reason);
    if (g.status === 'fulfilled') setGit(g.value); else error(g.reason);
    if (a.status === 'fulfilled') setActivities(a.value); else error(a.reason);
  }, [error]);

  const loadSessions = useCallback(async () => {
    const expected = getActiveWorkspace()?.id;
    const results = await Promise.allSettled([request<Session[]>('sessions.list'), request<Provider[]>('providers.list')]);
    if (getActiveWorkspace()?.id !== expected) return;
    if (results[0].status === 'fulfilled') setSessions(results[0].value); else error(results[0].reason);
    if (results[1].status === 'fulfilled') setProviders(results[1].value); else error(results[1].reason);
  }, [error]);

  const openFile = useCallback(async (path: string, targetLine?: number) => {
    setDiff(null); setRemoteDetail(null); setLine(targetLine);
    if (tabsRef.current.some(file => file.path === path)) { setActive(path); return; }
    const expected = getActiveWorkspace()?.id;
    try {
      const result = await request<{ content: string; stamp: string }>('workspace.read', { path });
      if (getActiveWorkspace()?.id !== expected) return;
      setTabs(previous => previous.some(file => file.path === path) ? previous : [...previous, { path, content: result.content, savedContent: result.content, stamp: result.stamp, language: languageFor(path) }]); setActive(path);
    } catch (e) { error(e); }
  }, [error]);

  const showDiff = useCallback(async (path: string, staged = false) => {
    const expected = getActiveWorkspace()?.id;
    try { const result = await request<{ original: string; modified: string }>('git.diff', { path, staged }); if (getActiveWorkspace()?.id !== expected) return; setDiff({ path, ...result, staged }); setRemoteDetail(null); } catch (e) { error(e); }
  }, [error]);

  const chooseWorkspace = useCallback(async (path?: string) => {
    setBusy('Ouverture du projet…');
    try {
      const result = await openWorkspace(path); if (!result) return;
      setWorkspace(result); setTabs([]); setActive(''); setDiff(null); setSessions([]); setProviders([]); setActivities([]); setPlan(initialPlan); setTerminals([]); setConnection(null); setRemoteItems([]); setRemoteDetail(null); setMcpConfig(null); setHits([]); setTreeRevision(value => value + 1);
      await refresh(); void loadSessions();
      void request<RemoteConnection | null>('remote.connection').then(setConnection).catch(error);
      void request<{ openFiles?: string[]; activeFile?: string } | null>('preferences.get').then(async layout => { if (layout?.openFiles?.length) { for (const file of layout.openFiles.slice(0, 20)) await openFile(file); if (layout.activeFile) setActive(layout.activeFile); } else if (!desktop) await openFile('README.md'); }).catch(error);
    } catch (e) { error(e); } finally { setBusy(''); }
  }, [error, refresh, loadSessions, openFile]);

  function openFolder() {
    if (tabs.some(file => file.content !== file.savedContent)) {
      setDialog({ title: 'Changer de projet', description: 'Certains fichiers contiennent des modifications non enregistrées. En continuant, vous abandonnez ces modifications.', fields: [], submit: 'Abandonner et ouvrir', danger: true, onSubmit: async () => { await chooseWorkspace(); } });
    } else void chooseWorkspace();
  }

  useEffect(() => { if (!desktop) void chooseWorkspace(); }, [chooseWorkspace]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 10000); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => { localStorage.setItem('galeata:plan-visible', String(planVisible)); }, [planVisible]);
  useEffect(() => {
    if (!workspace) return;
    const timer = setTimeout(() => { void request('preferences.save', { openFiles: tabs.map(file => file.path), activeFile: active }).catch(error); }, 600);
    return () => clearTimeout(timer);
  }, [workspace, tabs, active, error]);

  useEffect(() => {
    if (!workspace) return;
    let disposed = false; const cleanups: (() => void)[] = []; let timer: ReturnType<typeof setTimeout> | undefined;
    const register = async <T,>(event: string, handler: (event: T) => void) => { const clean = await subscribe<T>(event, handler); if (disposed) clean(); else cleanups.push(clean); };
    const changed = (event: { workspaceId: string }) => { if (event.workspaceId !== workspace.id) return; clearTimeout(timer); timer = setTimeout(() => { void refresh(); setTreeRevision(value => value + 1); }, 300); };
    void register('workspace:changed', changed).catch(error); void register('plan:changed', changed).catch(error); void register('activity:changed', changed).catch(error);
    void register<{ workspaceId: string; method: string; args: { path: string; line?: number; staged?: boolean } }>('ui:request', event => { if (event.workspaceId !== workspace.id) return; if (event.method === 'ui.show_diff') void showDiff(event.args.path, event.args.staged); else void openFile(event.args.path, event.args.line); }).catch(error);
    return () => { disposed = true; clearTimeout(timer); cleanups.forEach(clean => clean()); };
  }, [workspace, refresh, error, showDiff, openFile]);

  useEffect(() => {
    if (!workspace || !active) return;
    let disposed = false;
    async function check() {
      const previous = tabsRef.current.find(file => file.path === active); if (!previous) return;
      try { const result = await request<{ content: string; stamp: string }>('workspace.read', { path: active }); if (disposed || result.stamp === previous.stamp) return;
        setTabs(files => files.map(file => file.path !== active ? file : file.content !== file.savedContent ? { ...file, external: true } : { ...file, content: result.content, savedContent: result.content, stamp: result.stamp, external: false }));
      } catch { /* The user sees missing-file errors when opening or saving. */ }
    }
    void check(); const interval = setInterval(() => { if (!document.hidden) void check(); }, 5000);
    return () => { disposed = true; clearInterval(interval); };
  }, [workspace, active, treeRevision]);

  async function saveFile(path: string) {
    const file = tabsRef.current.find(file => file.path === path); if (!file || file.content === file.savedContent) return;
    try { const result = await request<{ stamp: string }>('workspace.write', { path, content: file.content, stamp: file.stamp }); setTabs(previous => previous.map(current => current.path === path ? { ...current, stamp: result.stamp, savedContent: file.content, external: false } : current)); await refresh(); } catch (e) { error(e); throw e; }
  }
  function removeTab(path: string) { setTabs(previous => previous.filter(file => file.path !== path)); if (active === path) setActive(tabs.find(file => file.path !== path)?.path ?? ''); }
  function closeTab(path: string) {
    const file = tabs.find(file => file.path === path);
    if (file && file.content !== file.savedContent) setDialog({ title: 'Fermer le fichier', description: `Des modifications de ${path} ne sont pas enregistrées.`, fields: [{ name: 'action', label: 'Action', options: [{ value: 'save', label: 'Enregistrer puis fermer' }, { value: 'discard', label: 'Abandonner les modifications' }] }], submit: 'Fermer le fichier', onSubmit: async values => { if (values.action === 'save') await saveFile(path); removeTab(path); } });
    else removeTab(path);
  }
  async function savePlan(next: Plan) {
    try { const result = await request<Plan>('plan.save', { revision: next.revision, plan: next }); setPlan(result); await refresh(); } catch (e) { error(e); await refresh(); throw e; }
  }
  function updateStep(step: Step, status: Step['status']) { void request<Plan>('plan.update_step', { id: step.id, status, revision: plan.revision }).then(result => { setPlan(result); return refresh(); }).catch(e => { error(e); void refresh(); }); }
  function editObjective() { setDialog({ title: 'Objectif de la mission', description: 'Ce cap reste sous votre contrôle. Les agents peuvent proposer son évolution.', fields: [{ name: 'objective', label: 'Objectif', type: 'textarea', value: plan.objective, required: true }], onSubmit: async values => savePlan({ ...plan, objective: values.objective }) }); }
  function fileAction(action: 'create' | 'rename' | 'delete', directory = false) {
    if (action !== 'create' && !active) return;
    if (action !== 'create' && activeFile?.content !== activeFile?.savedContent) { error('Enregistrez le fichier avant cette action.'); return; }
    setDialog({ title: action === 'create' ? directory ? 'Nouveau dossier' : 'Nouveau fichier' : action === 'rename' ? 'Renommer le fichier' : 'Supprimer le fichier', description: action === 'delete' ? `Supprimer définitivement ${active} ?` : 'Indiquez un chemin relatif au projet. Le dossier parent doit exister.', fields: action === 'delete' ? [] : [{ name: 'path', label: 'Chemin', value: action === 'rename' ? active : '', placeholder: 'src/nouveau-fichier.ts', required: true }], danger: action === 'delete', submit: action === 'delete' ? 'Supprimer' : 'Enregistrer', onSubmit: async values => { if (action === 'create') await request('workspace.create', { path: values.path, directory }); else if (action === 'rename') await request('workspace.rename', { path: active, destination: values.path }); else await request('workspace.delete', { path: active }); if (action !== 'create') removeTab(active); setTreeRevision(value => value + 1); if (action === 'rename' || action === 'create' && !directory) await openFile(values.path); await refresh(); } });
  }
  function launchAgent(kind: string, sessionId?: string) { const launch = { key: crypto.randomUUID(), kind, sessionId }; setTerminals(previous => [...previous, { launch }]); setTerminalKey(launch.key); setBottom('terminal'); setBottomVisible(true); }
  const terminalReady = useCallback((key: string, id: string) => setTerminals(previous => previous.map(tab => tab.launch.key === key ? { ...tab, id } : tab)), []);
  const terminalExit = useCallback((key: string) => { setTerminals(previous => previous.map(tab => tab.launch.key === key ? { ...tab, exited: true } : tab)); void refresh(); void loadSessions(); }, [refresh, loadSessions]);
  function closeTerminal(key: string) { setTerminals(previous => previous.filter(tab => tab.launch.key !== key)); if (terminalKey === key) setTerminalKey(terminals.find(tab => tab.launch.key !== key)?.launch.key ?? ''); }
  async function mutateGit(action: string, args: Record<string, unknown> = {}) { setBusy(`Git · ${action}…`); try { setGit(await request<GitStatus>('git.mutate', { action, ...args })); await refresh(); } catch (e) { error(e); throw e; } finally { setBusy(''); } }
  function gitDialog(action: 'branch' | 'switch' | 'worktree') { setDialog({ title: action === 'branch' ? 'Créer une branche' : action === 'switch' ? 'Changer de branche' : 'Créer un worktree', fields: [{ name: 'name', label: 'Branche', required: true, placeholder: 'feature/ma-mission' }, ...(action === 'worktree' ? [{ name: 'path', label: 'Nouveau dossier (chemin absolu)', required: true, placeholder: '/home/vous/projets/ma-mission' }] : [])], submit: 'Continuer', onSubmit: async values => mutateGit(action, values) }); }

  useEffect(() => {
    if (!workspace || !query.trim()) { setHits([]); setSearchNext(null); setSearching(false); return; }
    let cancelled = false; const timeout = setTimeout(() => { setSearching(true); void request<{ items: SearchHit[]; nextOffset: number | null }>(searchFiles ? 'workspace.search_files' : 'workspace.search_text', { query }).then(result => { if (!cancelled) { setHits(result.items); setSearchNext(result.nextOffset); } }).catch(e => { if (!cancelled) error(e); }).finally(() => { if (!cancelled) setSearching(false); }); }, 250);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [query, searchFiles, workspace, error]);
  useEffect(() => {
    if (!palette || !paletteQuery.trim() || !workspace) { setPaletteHits([]); return; }
    let cancelled = false; const timer = setTimeout(() => { void request<{ items: SearchHit[] }>('workspace.search_files', { query: paletteQuery }).then(result => { if (!cancelled) setPaletteHits(result.items.slice(0, 20)); }).catch(error); }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [palette, paletteQuery, workspace, error]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'p') { event.preventDefault(); setPalette(value => !value); }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); if (active) void saveFile(active).catch(() => {}); }
      if (event.key === '`') { event.preventDefault(); setBottomVisible(value => !value); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (tabsRef.current.some(file => file.content !== file.savedContent)) event.preventDefault(); }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, []);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false; let cleanup: (() => void) | undefined;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const nativeWindow = getCurrentWindow();
      cleanup = await nativeWindow.onCloseRequested(event => {
        if (!tabsRef.current.some(file => file.content !== file.savedContent)) return;
        event.preventDefault();
        setDialog({ title: 'Fermer Galeata', description: 'Certains fichiers contiennent des modifications non enregistrées.', fields: [{ name: 'action', label: 'Action', options: [{ value: 'save', label: 'Tout enregistrer puis quitter' }, { value: 'discard', label: 'Abandonner les modifications et quitter' }] }], submit: 'Quitter', onSubmit: async values => { if (values.action === 'save') for (const file of tabsRef.current) await saveFile(file.path); await nativeWindow.destroy(); } });
      });
      if (disposed) cleanup();
    }).catch(error);
    return () => { disposed = true; cleanup?.(); };
    // saveFile reads current buffers through tabsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  async function refreshRemote() { setBusy('Chargement du service distant…'); try { setRemoteItems(await request<RemoteItem[]>('remote.list')); } catch (e) { error(e); } finally { setBusy(''); } }
  function connectRemote() { setDialog({ title: 'Connecter un service Git', description: 'Le jeton est conservé dans le coffre système Linux. Accès requis : lecture du dépôt et des PR/MR et pipelines.', fields: [{ name: 'provider', label: 'Service', options: [{ value: 'github', label: 'GitHub' }, { value: 'gitlab', label: 'GitLab' }] }, { name: 'host', label: 'Origine API (facultatif)', placeholder: 'https://gitlab.mon-entreprise.fr' }, { name: 'project', label: 'Projet', placeholder: 'OlivierLB/Galeata', required: true }, { name: 'token', label: 'Jeton d’accès', type: 'password', required: true }], submit: 'Connecter', onSubmit: async values => { const args: Record<string, unknown> = { ...values }; if (!values.host.trim()) delete args.host; const connected = await request<RemoteConnection>('remote.connect', args); setConnection(connected); await refreshRemote(); } }); }
  function saveHandoff() { setDialog({ title: 'Préparer la reprise', fields: [{ name: 'message', label: 'Travail effectué et décisions', type: 'textarea', required: true }, { name: 'nextAction', label: 'Prochaine action', required: true }, { name: 'sessionId', label: 'Identifiant de session (facultatif)' }], onSubmit: async values => { await request('session.save_handoff', values); await refresh(); } }); }
  function runVerification() {
    setDialog({ title: 'Exécuter une vérification', description: 'La commande est exécutée dans ce projet, sans shell intermédiaire. Durée maximale : 120 secondes. Son code de sortie et ses sorties seront enregistrés.', fields: [{ name: 'program', label: 'Programme', value: 'npm', required: true }, { name: 'args', label: 'Arguments (tableau JSON)', value: '["test"]', required: true }, { name: 'stepId', label: 'Étape associée', options: [{ value: '', label: 'Aucune étape' }, ...plan.steps.map(step => ({ value: step.id, label: step.title }))] }], submit: 'Exécuter', onSubmit: async values => {
      const args: unknown = JSON.parse(values.args);
      if (!Array.isArray(args) || !args.every(arg => typeof arg === 'string')) throw new Error('Utilisez un tableau JSON de chaînes, par exemple ["test"].');
      await request('verification.run', { program: values.program, args, stepId: values.stepId });
      await refresh(); setBottom('checks'); setBottomVisible(true);
    } });
  }
  async function acceptProposal(event: Activity) {
    if (event.data.baseRevision !== plan.revision) { error('Le plan a évolué depuis cette proposition. Demandez une proposition actualisée.'); return; }
    const steps = Array.isArray(event.data.steps) ? event.data.steps.map((value: unknown) => { const step = value as Partial<Step>; return { id: step.id || crypto.randomUUID(), title: String(step.title ?? ''), status: step.status ?? 'pending', note: step.note ?? '', author: 'vous', updatedAt: Date.now() }; }) : plan.steps;
    await savePlan({ ...plan, objective: String(event.data.objective ?? plan.objective), steps });
  }
  const currentAgentEvents = activities.filter(event => event.kind === 'activity' && event.data.sessionId).filter((event, index, all) => all.findIndex(other => other.data.sessionId === event.data.sessionId) === index);
  const activeCount = currentAgentEvents.filter(event => event.data.status === 'running').length;
  const overlappingFiles = new Set<string>(); const claimed = new Map<string, string>();
  for (const event of currentAgentEvents.filter(event => event.data.status === 'running')) for (const file of Array.isArray(event.data.files) ? event.data.files : []) if (typeof file === 'string') { if (claimed.has(file) && claimed.get(file) !== event.data.sessionId) overlappingFiles.add(file); claimed.set(file, String(event.data.sessionId)); }
  const displayFile: OpenFile | undefined = diff ? { path: diff.path, content: diff.modified, savedContent: diff.modified, stamp: '', language: languageFor(diff.path) } : activeFile;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img src="/galeata-logo.svg" alt="Galeata" /></div><div className="topbar-divider" /><button className="workspace-picker" onClick={openFolder}><Icon name="folder" size={15} /><span>{workspace?.name ?? 'Ouvrir un projet'}</span><Icon name="chevron" size={12} className="rotated" /></button>{workspace && git.isRepo ? <button className="branch-badge" onClick={() => gitDialog('switch')}><Icon name="branch" size={13} />{git.branch}</button> : null}<button className="command-trigger" onClick={() => setPalette(true)}><Icon name="search" size={14} /><span>Rechercher un fichier ou une action…</span><kbd>Ctrl P</kbd></button><div className="topbar-actions">{!desktop ? <span className="preview-badge">APERÇU INTERFACE</span> : <span className="local-badge"><span className="status-dot" /> Local</span>}<button className={`icon-button ${planVisible ? 'active' : ''}`} title="Afficher ou masquer le plan" aria-label="Afficher ou masquer le plan" onClick={() => setPlanVisible(value => !value)}><Icon name="panel" /></button></div></header>
    <main className="workspace-layout">
      <nav className="activity-rail" aria-label="Navigation principale"><div>{navigation.map(item => <button key={item.id} className={`rail-button ${panel === item.id ? 'active' : ''}`} title={item.label} aria-label={item.label} aria-pressed={panel === item.id} onClick={() => setPanel(item.id)}><Icon name={item.icon} size={21} />{item.id === 'git' && git.files.length ? <span className="rail-count">{git.files.length}</span> : item.id === 'agents' && activeCount ? <span className="rail-count">{activeCount}</span> : null}</button>)}</div><div><button className="rail-button" title="Historique" aria-label="Historique" onClick={() => { setBottom('activity'); setBottomVisible(true); }}><Icon name="history" size={21} /></button><button className={`rail-button ${panel === 'settings' ? 'active' : ''}`} aria-label="Préférences" title="Préférences" onClick={() => { setPanel('settings'); if (workspace) void request<Record<string, unknown>>('mcp.config').then(setMcpConfig).catch(error); }}><Icon name="settings" size={21} /></button><div className="avatar" title="Espace personnel">OL</div></div></nav>
      <aside className="sidebar"><div className="panel-heading"><span>{panelNames[panel]}</span><button className="icon-button" aria-label="Actualiser" title="Actualiser" disabled={!workspace} onClick={() => { void refresh(); setTreeRevision(value => value + 1); if (panel === 'agents') void loadSessions(); if (panel === 'remote' && connection) void refreshRemote(); }}><Icon name="refresh" size={14} /></button></div>
        {!workspace ? <div className="sidebar-empty"><Icon name="folder" size={25} /><p>Votre prochain projet commence ici.</p><button className="button small" onClick={openFolder}>Ouvrir un dossier</button></div> : <>
          {panel === 'files' ? <><div className="project-heading"><span><Icon name="chevron" className="rotated" size={12} />{workspace.name.toUpperCase()}</span><div><button className="icon-button" title="Nouveau fichier" aria-label="Nouveau fichier" onClick={() => fileAction('create')}><Icon name="plus" size={14} /></button><button className="icon-button" title="Nouveau dossier" aria-label="Nouveau dossier" onClick={() => fileAction('create', true)}><Icon name="folder" size={14} /></button></div></div><FileTree workspaceId={workspace.id} revision={treeRevision} selected={active} onOpen={path => void openFile(path)} onError={error} /><div className="sidebar-bottom"><Icon name="spark" size={15} /><div><strong>Gardez le fil.</strong><p>Le plan et le contexte restent à portée de main.</p></div></div></> : null}
          {panel === 'search' ? <div className="sidebar-content"><div className="search-input"><Icon name="search" size={15} /><input aria-label="Rechercher dans le projet" placeholder="Rechercher dans le projet…" value={query} onChange={event => setQuery(event.target.value)} /></div><label className="checkbox-label"><input type="checkbox" checked={searchFiles} onChange={event => setSearchFiles(event.target.checked)} /> Noms de fichiers uniquement</label><p className="section-caption">{searching ? 'Recherche…' : query ? `${hits.length} résultat(s)` : 'Recherche locale avec ripgrep'}</p><div className="search-results">{hits.map((hit, index) => <button key={`${hit.path}:${hit.line}:${index}`} className="search-hit" onClick={() => void openFile(hit.path, hit.line || undefined)}><span>{hit.path}{hit.line ? <small>:{hit.line}</small> : null}</span>{hit.text ? <code>{hit.text.trim()}</code> : null}</button>)}{query && !searching && !hits.length ? <p className="muted">Aucun résultat.</p> : null}{searchNext !== null ? <button className="text-button" onClick={() => { void request<{ items: SearchHit[]; nextOffset: number | null }>(searchFiles ? 'workspace.search_files' : 'workspace.search_text', { query, offset: searchNext }).then(result => { setHits(previous => [...previous, ...result.items]); setSearchNext(result.nextOffset); }).catch(error); }}>Charger la suite</button> : null}</div></div> : null}
          {panel === 'git' ? <div className="sidebar-content">{git.isRepo ? <><div className="section-line"><span className="branch-name"><Icon name="branch" size={15} />{git.branch}</span><span className="count">{git.files.length}</span></div><div className="git-actions">{['fetch', 'pull', 'push'].map(action => <button key={action} className="button secondary small" disabled={!!busy} onClick={() => void mutateGit(action).catch(() => {})}>{action}</button>)}</div><textarea className="commit-input" aria-label="Message de commit" placeholder="Décrire les changements…" rows={3} value={commitMessage} onChange={event => setCommitMessage(event.target.value)} /><button className="button full" disabled={!commitMessage.trim() || !!busy} onClick={() => void mutateGit('commit', { message: commitMessage }).then(() => setCommitMessage('')).catch(() => {})}><Icon name="check" size={15} />Créer le commit</button><div className="section-line"><h3>Changements</h3><span className="count">{git.files.length}</span></div>{git.files.map(file => <div className="git-file" key={file.path}><button className="truncate" title={`Diff non indexé : ${file.path}`} onClick={() => void showDiff(file.path, false)}><span className="git-status-letter">{file.worktree === ' ' ? file.index : file.worktree}</span>{file.path}</button>{file.index !== ' ' && file.index !== '?' ? <><button className="icon-button" title="Voir le diff indexé" aria-label={`Diff indexé ${file.path}`} onClick={() => void showDiff(file.path, true)}><Icon name="files" size={13} /></button><button className="icon-button" title="Désindexer" aria-label={`Désindexer ${file.path}`} onClick={() => void mutateGit('unstage', { path: file.path }).catch(() => {})}>−</button></> : null}<button className="icon-button" title="Indexer" aria-label={`Indexer ${file.path}`} onClick={() => void mutateGit('stage', { path: file.path }).catch(() => {})}><Icon name="plus" size={13} /></button></div>)}{!git.files.length ? <div className="empty-state compact"><Icon name="check" size={24} /><p>Aucun changement local.</p></div> : null}<div className="section-line"><h3>Branches & isolation</h3></div><button className="sidebar-action" onClick={() => gitDialog('branch')}><Icon name="branch" size={15} />Créer une branche</button><button className="sidebar-action" onClick={() => gitDialog('worktree')}><Icon name="folder" size={15} />Créer un worktree</button><button className="sidebar-action" onClick={() => { void request<string>('git.worktrees').then(text => setDialog({ title: 'Worktrees du projet', description: text, fields: [], submit: 'Fermer', onSubmit: async () => {} })).catch(error); }}><Icon name="files" size={15} />Voir les worktrees</button></> : <div className="empty-state compact"><Icon name="git" size={28} /><p>Ce dossier n’est pas un dépôt Git.</p><span className="muted">Initialisez-le depuis le terminal pour activer le suivi.</span></div>}</div> : null}
          {panel === 'agents' ? <div className="sidebar-content"><p className="section-caption">VOS OUTILS, VOTRE ENVIRONNEMENT</p>{['codex', 'claude'].map(id => { const provider = providers.find(value => value.id === id); return <div className="provider-card" key={id}><div className="provider-logo">{id === 'codex' ? '⌘' : '✳'}</div><div><strong>{id === 'codex' ? 'Codex' : 'Claude Code'}</strong><span>{provider?.available ? 'Installé · terminal local' : !desktop ? 'Application de bureau requise' : providers.length ? 'Non disponible' : 'Détection…'}</span></div><button className="icon-button" title={`Lancer ${id}`} aria-label={`Lancer ${id}`} disabled={!provider?.available} onClick={() => launchAgent(id)}><Icon name="play" size={14} /></button></div>; })}<p className="section-caption">ACTIVITÉ DÉCLARÉE VIA MCP</p>{currentAgentEvents.map(event => <article className="agent-card" key={event.id}><span className={`status-dot ${event.data.status === 'blocked' ? 'warning' : event.data.status === 'done' ? 'idle' : ''}`} /><div><strong>{String(event.data.sessionId).slice(0, 12)}</strong><p>{event.message}</p><small>{relativeTime(event.createdAt)} · {String(event.data.status)}</small>{event.data.parentId ? <small>Sous-agent de {String(event.data.parentId).slice(0, 12)}</small> : null}</div></article>)}{!currentAgentEvents.length ? <p className="muted small-copy">Les agents apparaissent ici lorsqu’ils déclarent leur mission via le MCP. Aucun état d’activité n’est déduit du terminal.</p> : null}{overlappingFiles.size ? <div className="inline-error"><Icon name="warning" size={14} />Chevauchement déclaré : {[...overlappingFiles].join(', ')}</div> : null}<div className="section-line"><h3>Reprendre une session</h3><span className="count">{sessions.length}</span></div>{sessions.map(session => <article className="session-card" key={`${session.provider}:${session.id}`}><div className="session-provider">{session.provider === 'codex' ? 'CODEX' : 'CLAUDE CODE'}<span>{relativeTime(session.modifiedAt)}</span></div><strong>{session.title}</strong>{session.summary ? <p>{session.summary}</p> : <p className="muted">Pas de résumé fourni par l’outil.</p>}{session.parentId ? <small>Sous-agent · parent {session.parentId.slice(0, 8)}</small> : null}<button className="text-button" disabled={!providers.find(provider => provider.id === session.provider)?.available} onClick={() => launchAgent(session.provider, session.id)}>Reprendre <Icon name="arrow" size={13} /></button></article>)}{!sessions.length ? <p className="muted small-copy">Aucune session découverte pour ce dossier.</p> : null}<button className="sidebar-action" onClick={saveHandoff}><Icon name="history" size={15} />Enregistrer une passation</button></div> : null}
          {panel === 'remote' ? <div className="sidebar-content">{connection ? <><div className="connection-card"><Icon name="cloud" size={24} /><strong>{connection.provider === 'github' ? 'GitHub' : 'GitLab'}</strong><code>{connection.project}</code><small>{connection.host}</small></div><button className="button full" disabled={!!busy} onClick={() => void refreshRemote()}>Charger les PR / MR</button><p className="section-caption">DEMANDES OUVERTES · 50 PREMIÈRES</p>{remoteItems.map(item => <button className="remote-item" key={item.id} onClick={() => { setBusy('Chargement des changements…'); void request<RemoteDetail>('remote.detail', { id: item.id }).then(detail => { setRemoteDetail({ item, detail }); setDiff(null); }).catch(error).finally(() => setBusy('')); }}><span>#{item.id} <span className="remote-state">{item.state}</span></span><strong>{item.title}</strong><small>{item.source} → {item.target}</small></button>)}<button className="text-button" onClick={() => { void request('remote.disconnect').then(() => { setConnection(null); setRemoteItems([]); }).catch(error); }}>Déconnecter</button></> : <div className="empty-state compact"><Icon name="cloud" size={32} /><h3>Le dépôt, au-delà du local.</h3><p>Consultez vos demandes de changement et leurs vérifications sans quitter Galeata.</p><button className="button small" onClick={connectRemote}>Connecter GitHub / GitLab</button></div>}</div> : null}
          {panel === 'settings' ? <div className="sidebar-content"><p className="section-caption">GALEATA 0.1.0 · LINUX</p><h3>Un espace local</h3><p className="small-copy muted">Plans et historique restent sur votre machine. Aucun compte Galeata ni télémétrie.</p><div className="section-line"><h3>MCP interne</h3><Icon name="link" size={15} /></div><p className="small-copy muted">Les agents lancés ici reçoivent une configuration MCP pour ce projet lorsque le binaire galeata-mcp est disponible.</p><button className="sidebar-action" onClick={() => void request<Record<string, unknown>>('mcp.config').then(setMcpConfig).catch(error)}><Icon name="refresh" size={14} />Afficher la configuration</button>{mcpConfig ? <pre className="config-code">{JSON.stringify(mcpConfig, null, 2)}</pre> : null}<div className="section-line"><h3>Raccourcis</h3></div><div className="shortcut-row"><span>Fichier / action</span><kbd>Ctrl P</kbd></div><div className="shortcut-row"><span>Enregistrer</span><kbd>Ctrl S</kbd></div><div className="shortcut-row"><span>Terminal</span><kbd>Ctrl `</kbd></div><button className="sidebar-action" onClick={() => setPlanVisible(value => !value)}><Icon name="panel" size={15} />{planVisible ? 'Replier' : 'Afficher'} le plan</button></div> : null}
        </>}
      </aside>
      <section className="central-workspace" aria-label="Espace de travail">
        <div className="editor-tabs"><div className="tab-list" role="tablist" aria-label="Fichiers ouverts">{tabs.map(file => <div key={file.path} className={`editor-tab ${active === file.path && !diff && !remoteDetail ? 'active' : ''}`}><button role="tab" aria-selected={active === file.path && !diff && !remoteDetail} title={file.path} onClick={() => { setActive(file.path); setDiff(null); setRemoteDetail(null); }}><span className="tab-file-icon">{file.path.endsWith('.md') ? 'M↓' : file.path.endsWith('.rs') ? 'Rs' : '✳'}</span>{file.path.split('/').pop()}{file.content !== file.savedContent ? <span className="dirty-dot" /> : null}</button><button className="tab-close" aria-label={`Fermer ${file.path}`} onClick={() => closeTab(file.path)}><Icon name="close" size={12} /></button></div>)}{diff ? <div className="editor-tab active"><button role="tab" aria-selected="true"><Icon name="git" size={13} />{diff.path.split('/').pop()} · {diff.staged ? 'indexé' : 'diff'}</button><button className="tab-close" aria-label="Fermer le diff" onClick={() => setDiff(null)}><Icon name="close" size={12} /></button></div> : null}{!tabs.length && !diff ? <span className="empty-tab">Bienvenue dans Galeata</span> : null}</div><div className="editor-tab-actions"><button className="icon-button" title="Enregistrer le fichier" aria-label="Enregistrer le fichier" disabled={!activeFile || !!diff} onClick={() => void saveFile(active).catch(() => {})}><Icon name="save" size={14} /></button><button className="icon-button" title="Renommer le fichier" aria-label="Renommer le fichier" disabled={!activeFile} onClick={() => fileAction('rename')}><Icon name="edit" size={14} /></button><button className="icon-button" title="Supprimer le fichier" aria-label="Supprimer le fichier" disabled={!activeFile} onClick={() => fileAction('delete')}><Icon name="trash" size={14} /></button></div></div>
        {remoteDetail ? <div className="remote-detail"><div className="remote-detail-heading"><span className="eyebrow">DEMANDE #{remoteDetail.item.id}</span><h2>{remoteDetail.item.title}</h2><p>{remoteDetail.item.source} → {remoteDetail.item.target}</p><button className="text-button" onClick={() => setRemoteDetail(null)}>Revenir à l’éditeur</button></div><div className="remote-checks">{remoteDetail.detail.checks.map(check => <span key={check.name} className="check-chip">{check.name} · {check.status}</span>)}</div><p className="muted small-copy">Affichage limité aux 100 premiers fichiers et résultats CI fournis par le service.</p>{remoteDetail.detail.changes.map(change => <section className="remote-change" key={change.path}><h3>{change.path}</h3><pre>{change.patch}</pre></section>)}</div> : displayFile ? <><div className="breadcrumbs"><Icon name="folder" size={13} /><span>{workspace?.name}</span>{displayFile.path.split('/').map((part, index) => <span key={index}><Icon name="chevron" size={10} />{part}</span>)}<span className="editor-language">{displayFile.language}</span></div>{activeFile?.external && !diff ? <div className="conflict-banner"><Icon name="warning" size={15} /><span>Ce fichier a changé sur disque. Vos modifications sont conservées.</span><button className="text-button" onClick={() => { void request<{ content: string; stamp: string }>('workspace.read', { path: active }).then(result => setDiff({ path: active, original: result.content, modified: activeFile.content, staged: false })).catch(error); }}>Comparer</button><button className="text-button" onClick={() => setDialog({ title: 'Recharger le fichier', description: 'Abandonner vos modifications et charger la version du disque ?', fields: [], submit: 'Recharger', danger: true, onSubmit: async () => { const result = await request<{ content: string; stamp: string }>('workspace.read', { path: active }); setTabs(previous => previous.map(file => file.path === active ? { ...file, content: result.content, savedContent: result.content, stamp: result.stamp, external: false } : file)); } })}>Recharger</button></div> : null}<Suspense fallback={<div className="loading-editor">Préparation de l’éditeur…</div>}><EditorSurface key={`${workspace?.id}:${displayFile.path}:${diff ? 'diff' : 'edit'}:${diff?.original ?? ''}`} file={displayFile} diff={diff ?? undefined} line={line} onChange={content => setTabs(previous => previous.map(file => file.path === active ? { ...file, content } : file))} onSave={() => void saveFile(active).catch(() => {})} /></Suspense></> : <div className="welcome"><div className="welcome-emblem"><Icon name="spark" size={48} /></div><span className="eyebrow">VOTRE CODE. VOS AGENTS. UNE VISION CLAIRE.</span><h1>Gardez le fil.<br /><span>Construisez la suite.</span></h1><p>Un espace pour vos fichiers, vos agents et le plan qui les relie. Reprenez exactement là où vous en étiez.</p><div className="welcome-actions"><button className="button" onClick={openFolder}><Icon name="folder" size={16} />Ouvrir un dossier<Icon name="arrow" size={15} /></button>{desktop && localStorage.getItem('galeata:last-workspace') ? <button className="text-button" onClick={() => void chooseWorkspace(localStorage.getItem('galeata:last-workspace') ?? undefined)}>Reprendre le dernier projet</button> : null}</div><div className="welcome-features"><span><Icon name="plan" size={16} />Un plan vivant</span><span><Icon name="agents" size={16} />Vos outils habituels</span><span><Icon name="git" size={16} />Des changements lisibles</span></div></div>}
        {bottomVisible ? <section className="bottom-panel" aria-label="Terminal et activité"><div className="bottom-heading"><div className="bottom-tabs" role="tablist" aria-label="Outils du projet">{([{ id: 'terminal', label: 'Terminal', icon: 'terminal' }, { id: 'activity', label: 'Activité', icon: 'history' }, { id: 'checks', label: 'Vérifications', icon: 'check' }] as const).map(item => <button key={item.id} role="tab" aria-selected={bottom === item.id} className={bottom === item.id ? 'active' : ''} onClick={() => setBottom(item.id)}><Icon name={item.icon} size={13} />{item.label}{item.id === 'activity' && activities.length ? <span className="count">{activities.length}</span> : null}</button>)}</div><div><button className="icon-button" title="Nouveau terminal" aria-label="Nouveau terminal" disabled={!workspace || !desktop} onClick={() => launchAgent('shell')}><Icon name="plus" size={14} /></button><button className="icon-button" title="Masquer le terminal" aria-label="Masquer le terminal" onClick={() => setBottomVisible(false)}><Icon name="close" size={14} /></button></div></div>
          <div className="terminal-area" hidden={bottom !== 'terminal'}>{terminals.length ? <><div className="terminal-tabs">{terminals.map(tab => <div className={terminalKey === tab.launch.key ? 'active' : ''} key={tab.launch.key}><button onClick={() => setTerminalKey(tab.launch.key)}><span className={`status-dot ${tab.exited ? 'idle' : ''}`} />{tab.launch.kind}{tab.exited ? ' · terminé' : ''}</button><button aria-label={`Fermer le terminal ${tab.launch.kind}`} onClick={() => closeTerminal(tab.launch.key)}><Icon name="close" size={11} /></button></div>)}</div>{terminals.map(tab => <div className="terminal-mount" key={tab.launch.key} hidden={terminalKey !== tab.launch.key}><Suspense fallback={<p className="muted">Préparation du terminal…</p>}><TerminalView launch={tab.launch} onReady={terminalReady} onExit={terminalExit} active={terminalKey === tab.launch.key && bottom === 'terminal'} /></Suspense></div>)}</> : <div className="terminal-idle"><div><span className="prompt-symbol">❯</span><span>{!desktop ? 'Aperçu de l’interface · aucun processus local connecté.' : workspace ? 'Un terminal, votre shell, votre projet.' : 'Ouvrez un projet pour utiliser le terminal.'}</span><span className="terminal-cursor" /></div>{workspace && desktop ? <button className="text-button" onClick={() => launchAgent('shell')}>Ouvrir un terminal <Icon name="plus" size={13} /></button> : null}</div>}</div>
          {bottom !== 'terminal' ? <div className="activity-list">{activities.filter(event => bottom !== 'checks' || event.kind === 'verification').map(event => <article className="activity-event" key={event.id}><span className={`event-icon ${event.kind}`}><Icon name={event.kind === 'verification' ? 'check' : event.kind === 'proposal' ? 'warning' : event.kind === 'plan' ? 'plan' : 'history'} size={14} /></span><div><div><strong>{event.message}</strong><span className="event-meta">{event.author} · {relativeTime(event.createdAt)}</span></div>{event.kind === 'verification' ? <p className="muted">{event.data.provenance === 'galeata_observed' ? 'Exécuté par Galeata' : 'Rapport déclaré'}{event.data.exitCode !== undefined ? ` · code ${event.data.exitCode}` : ''} {String(event.data.command ?? '')}</p> : null}{event.kind === 'handoff' ? <p className="muted">Suite : {String(event.data.nextAction ?? '')}</p> : null}{event.kind === 'proposal' ? <div className="proposal-actions"><span>{String(event.data.objective ?? '')}</span><button className="text-button" onClick={() => setDialog({ title: 'Accepter la proposition', description: `${event.message}\n\nNouvel objectif : ${String(event.data.objective ?? '')}`, fields: [], submit: 'Appliquer au plan', onSubmit: async () => acceptProposal(event) })}>Examiner et accepter</button></div> : null}{event.data.output ? <details><summary>Voir la sortie</summary><pre>{String(event.data.output)}</pre></details> : null}</div></article>)}{!activities.filter(event => bottom !== 'checks' || event.kind === 'verification').length ? <div className="empty-activity"><Icon name={bottom === 'checks' ? 'check' : 'history'} size={22} /><p>{bottom === 'checks' ? 'Aucune vérification enregistrée pour ce projet.' : 'L’histoire de votre projet s’écrit ici.'}</p><span>Les événements réels apparaîtront au fil de votre travail.</span></div> : null}</div> : null}
        </section> : null}
      </section>
      {planVisible && workspace ? <PlanPanel plan={plan} activities={activities} onSave={savePlan} onStep={updateStep} onCollapse={() => setPlanVisible(false)} onHistory={() => { setBottom('activity'); setBottomVisible(true); }} onEdit={editObjective} /> : null}
    </main>
    <footer className="statusbar"><div>{git.isRepo ? <button onClick={() => setPanel('git')}><Icon name="branch" size={12} />{git.branch}</button> : <span><Icon name="folder" size={12} />{workspace ? 'Dossier local' : 'Aucun projet'}</span>}<button onClick={() => setPanel('agents')}><Icon name="agents" size={12} />{activeCount ? `${activeCount} agent(s) déclaré(s) actif(s)` : 'Agents au repos'}</button><button title="Exécuter une vérification" disabled={!workspace || !desktop} onClick={runVerification}><Icon name="check" size={12} />Vérifier</button></div><div><span className="status-message">{busy || (desktop ? 'Tout reste sur votre machine' : 'Démonstration · fichiers d’exemple')}</span>{activeFile ? <><span>UTF-8</span><span>{activeFile.language}</span></> : null}<button aria-label="Afficher le terminal" title="Afficher le terminal" onClick={() => setBottomVisible(value => !value)}><Icon name="terminal" size={13} /></button><span className="status-dot" /></div></footer>
    {toast ? <div className="toast" role="alert"><Icon name="warning" size={18} /><span>{toast}</span><button className="icon-button" aria-label="Fermer le message" onClick={() => setToast('')}><Icon name="close" size={15} /></button></div> : null}
    {dialog ? <Dialog key={dialog.title} spec={dialog} onClose={() => setDialog(null)} /> : null}
    {palette ? <div className="palette-backdrop" onClick={() => setPalette(false)}><section className="palette" role="dialog" aria-modal="true" aria-label="Fichiers et actions" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setPalette(false); }}><div className="palette-input"><Icon name="search" /><input autoFocus aria-label="Fichier ou action" placeholder="Rechercher un fichier ou choisir une action…" value={paletteQuery} onChange={event => setPaletteQuery(event.target.value)} /><kbd>Esc</kbd></div><div className="palette-results">{paletteQuery ? paletteHits.map(hit => <button key={hit.path} onClick={() => { void openFile(hit.path); setPalette(false); setPaletteQuery(''); }}><Icon name="files" size={15} />{hit.path}</button>) : <><button onClick={() => { setPalette(false); openFolder(); }}><Icon name="folder" size={16} />Ouvrir un dossier</button><button disabled={!workspace} onClick={() => { setPalette(false); fileAction('create'); }}><Icon name="plus" size={16} />Créer un fichier</button><button disabled={!workspace || !desktop} onClick={() => { setPalette(false); launchAgent('shell'); }}><Icon name="terminal" size={16} />Ouvrir un terminal</button><button onClick={() => { setPalette(false); setPanel('agents'); }}><Icon name="agents" size={16} />Voir les agents et les sessions</button><button onClick={() => { setPalette(false); setPlanVisible(value => !value); }}><Icon name="plan" size={16} />Afficher ou replier le plan</button></>}{paletteQuery && !paletteHits.length ? <p className="muted">Aucun fichier trouvé.</p> : null}</div><div className="palette-footer">Recherche dans le projet ouvert <kbd>Ctrl P</kbd></div></section></div> : null}
  </div>;
}

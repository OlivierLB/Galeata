import type { Activity, GitStatus, Plan, Workspace } from './types.ts';

export const desktop = '__TAURI_INTERNALS__' in window;
let activeWorkspace: Workspace | null = null;
export function setActiveWorkspace(workspace: Workspace | null) {
  activeWorkspace = workspace;
}
export function getActiveWorkspace() {
  return activeWorkspace;
}

export async function request<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!activeWorkspace) throw new Error('Ouvrez un dossier pour commencer');
  if (!desktop) return previewRequest(method, args) as T;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>('request', { method, args, workspaceId: activeWorkspace.id });
}
export async function openWorkspace(path?: string): Promise<Workspace | null> {
  if (!desktop) {
    setActiveWorkspace(previewWorkspace);
    return previewWorkspace;
  }
  if (!path) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Ouvrir un projet dans Galeata',
    });
    if (!selected || typeof selected !== 'string') return null;
    path = selected;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const workspace = await invoke<Workspace>('open_workspace', { path });
  setActiveWorkspace(workspace);
  localStorage.setItem('galeata:last-workspace', workspace.root);
  return workspace;
}
export async function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!desktop) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, ({ payload }) => handler(payload));
}

// Explicitly labelled browser preview. It never reads files, runs tools, or connects accounts.
export const previewWorkspace: Workspace = {
  id: 'preview',
  root: '/aperçu/galeata',
  name: 'Galeata',
};
const defaultPlan: Plan = {
  revision: 0,
  objective: 'Un espace clair pour développer avec vos agents.',
  steps: [
    {
      id: 'explore',
      title: 'Explorer le projet et poser les fondations',
      status: 'done',
      note: 'Exemple d’étape terminée par son auteur.',
      author: 'exemple',
      updatedAt: Date.now(),
    },
    {
      id: 'workspace',
      title: 'Construire l’espace de travail',
      status: 'in_progress',
      note: 'Fichiers, éditeur et plan réunis.',
      author: 'exemple',
      updatedAt: Date.now(),
    },
    {
      id: 'agents',
      title: 'Relier les agents au plan avec le MCP',
      status: 'pending',
      note: '',
      author: 'exemple',
      updatedAt: Date.now(),
    },
    {
      id: 'review',
      title: 'Vérifier les changements avant intégration',
      status: 'pending',
      note: '',
      author: 'exemple',
      updatedAt: Date.now(),
    },
  ],
};
const previewFiles: Record<string, string> = {
  'README.md':
    '# Galeata\n\nVotre code. Vos agents. Une vision claire.\n\nUn IDE local pour garder le fil de vos projets :\n\n- Un plan toujours visible\n- Des agents et leurs missions au même endroit\n- Des changements faciles à examiner\n- Le contexte pour reprendre là où vous en étiez\n\n## Commencer\n\nOuvrez un dossier dans l’application de bureau.\nLancez Codex ou Claude Code depuis le panneau Agents.\n\n> Vous consultez un aperçu de l’interface.\n> Aucun outil ni fichier local n’est connecté.\n',
  'src/main.tsx':
    'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\n\n// Un espace pour le code et les idées.\ncreateRoot(document.getElementById("root")!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n);\n',
  'src/App.tsx':
    'export default function App() {\n  return (\n    <main>\n      <h1>Bienvenue dans Galeata</h1>\n      <p>Gardez le fil. Construisez la suite.</p>\n    </main>\n  );\n}\n',
  'src/styles.css':
    ':root {\n  --background: #10121b;\n  --accent: #bfa9f6;\n  --brand: #19254b;\n}\n',
  'package.json': '{\n  "name": "galeata",\n  "version": "0.1.0",\n  "private": true\n}\n',
  '.gitignore': 'node_modules/\ndist/\nsrc-tauri/target/\n',
  'src-tauri/Cargo.toml': '[package]\nname = "galeata"\nversion = "0.1.0"\nedition = "2021"\n',
};
const previewGit: GitStatus = { branch: 'main', isRepo: true, files: [] };
let previewEvents: Activity[] = [];
let previewPlan: Plan;
try {
  previewPlan =
    JSON.parse(localStorage.getItem('galeata:preview-plan') ?? 'null') ??
    structuredClone(defaultPlan);
} catch {
  previewPlan = structuredClone(defaultPlan);
}
function previewRequest(method: string, args: Record<string, unknown>): unknown {
  switch (method) {
    case 'workspace.list': {
      const prefix = args.path ? `${args.path}/` : '';
      const children = new Map<
        string,
        { name: string; path: string; directory: boolean; symlink: boolean }
      >();
      for (const path of Object.keys(previewFiles)) {
        if (!path.startsWith(prefix)) continue;
        const name = path.slice(prefix.length).split('/')[0];
        children.set(name, {
          name,
          path: `${prefix}${name}`,
          directory: path.slice(prefix.length).includes('/'),
          symlink: false,
        });
      }
      return {
        items: [...children.values()].sort(
          (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
        ),
        total: children.size,
        nextOffset: null,
      };
    }
    case 'workspace.read':
      return { content: previewFiles[String(args.path)] ?? '', stamp: 'preview' };
    case 'workspace.search_files':
    case 'workspace.search_text':
      return {
        items: Object.entries(previewFiles).flatMap(([path, content]) =>
          method.endsWith('files')
            ? path.toLowerCase().includes(String(args.query).toLowerCase())
              ? [{ path, line: 0, text: '' }]
              : []
            : content
                .split('\n')
                .flatMap((text, i) =>
                  text.includes(String(args.query)) ? [{ path, line: i + 1, text }] : [],
                ),
        ),
        nextOffset: null,
      };
    case 'git.status':
      return previewGit;
    case 'git.branches':
      return ['main'];
    case 'git.worktrees':
      return 'Aucun worktree connecté dans l’aperçu.';
    case 'plan.get':
      return structuredClone(previewPlan);
    case 'plan.save':
    case 'plan.update_step': {
      if (args.revision !== previewPlan.revision)
        throw new Error('REVISION_CONFLICT : rechargez le plan');
      if (method === 'plan.save')
        previewPlan = { ...(args.plan as Plan), revision: previewPlan.revision + 1 };
      else
        previewPlan = {
          ...previewPlan,
          revision: previewPlan.revision + 1,
          steps: previewPlan.steps.map((step) =>
            step.id === args.id
              ? {
                  ...step,
                  status: args.status as typeof step.status,
                  author: 'vous',
                  updatedAt: Date.now(),
                }
              : step,
          ),
        };
      localStorage.setItem('galeata:preview-plan', JSON.stringify(previewPlan));
      previewEvents = [
        {
          id: crypto.randomUUID(),
          kind: 'plan',
          author: 'vous',
          message: 'Plan de démonstration modifié',
          createdAt: Date.now(),
          data: {},
        },
        ...previewEvents,
      ];
      return structuredClone(previewPlan);
    }
    case 'activity.list':
      return previewEvents;
    case 'sessions.list':
      return [];
    case 'providers.list':
      return ['codex', 'claude'].map((id) => ({
        id,
        available: false,
        version: '',
        capabilities: [],
      }));
    case 'remote.connection':
    case 'preferences.get':
      return null;
    case 'preferences.save':
      return null;
    case 'mcp.config':
      return {
        socket: 'Disponible dans l’application de bureau',
        workspaceId: 'preview',
        bridge: 'galeata-mcp',
        tools: [],
      };
    default:
      throw new Error(
        'Cette action nécessite l’application de bureau. L’aperçu n’accède pas à votre machine.',
      );
  }
}

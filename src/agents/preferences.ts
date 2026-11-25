import type { Provider } from './types.ts';

const KEY = 'galeata:default-agent';
const SHOW_TOOLS_KEY = 'galeata:show-tools';

/** Display preference only: agent events are retained while tool cards are hidden. */
export function readShowTools(): boolean {
  try {
    return localStorage.getItem(SHOW_TOOLS_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeShowTools(show: boolean) {
  try {
    localStorage.setItem(SHOW_TOOLS_KEY, String(show));
  } catch {
    /* storage unavailable: keep the in-memory choice */
  }
}

/** The agent started by "+", as chosen in the preferences (per machine). */
export function readDefaultAgent(): Provider {
  try {
    return localStorage.getItem(KEY) === 'codex' ? 'codex' : 'claude';
  } catch {
    return 'claude';
  }
}

export function writeDefaultAgent(provider: Provider) {
  try {
    localStorage.setItem(KEY, provider);
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
}

/** Preferred agent if installed, otherwise the other one, otherwise none. */
export function resolveAgent(preferred: Provider, available: Provider[]): Provider | null {
  if (available.includes(preferred)) return preferred;
  return available[0] ?? null;
}

/**
 * Permission modes per agent, from the strictest to "no limit" (same ids for
 * both agents). `danger` modes are never reached by Shift+Tab.
 */
export const agentModes: Record<
  Provider,
  { id: string; label: string; hint: string; danger?: boolean }[]
> = {
  claude: [
    {
      id: 'plan',
      label: 'Plan',
      hint: 'Lecture seule : Claude explore et propose un plan avant d’agir',
    },
    {
      id: 'default',
      label: 'Demander',
      hint: 'Demande avant toute action que vos règles ne couvrent pas',
    },
    {
      id: 'acceptEdits',
      label: 'Modifs auto',
      hint: 'Accepte les modifications de fichiers, demande pour les commandes',
    },
    {
      id: 'auto',
      label: 'Auto',
      hint: 'Claude décide seul des actions sans risque et demande pour le reste (votre mode habituel du terminal)',
    },
    {
      id: 'bypassPermissions',
      label: 'Sans limite',
      hint: 'Aucune demande : Claude exécute tout, y compris les commandes risquées. À réserver aux environnements jetables.',
      danger: true,
    },
  ],
  codex: [
    {
      id: 'plan',
      label: 'Plan',
      hint: 'Codex explore et prépare un plan en mode Plan natif, avant toute modification',
    },
    { id: 'default', label: 'Demander', hint: 'Demande avant toute commande qui n’est pas sûre' },
    {
      id: 'auto',
      label: 'Auto',
      hint: 'Agit seul dans le projet, demande seulement pour en sortir',
    },
    {
      id: 'bypassPermissions',
      label: 'Accès complet',
      hint: 'Aucune demande et aucun bac à sable : Codex a accès à toute la machine. À réserver aux environnements jetables.',
      danger: true,
    },
  ],
};

const MODE_KEY = (provider: Provider) => `galeata:${provider}-mode`;

/** Mode used when a conversation starts (default: Auto, like the terminal). */
export function readStartMode(provider: Provider): string {
  try {
    const stored = localStorage.getItem(MODE_KEY(provider));
    if (stored && agentModes[provider].some((mode) => mode.id === stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

export function writeStartMode(provider: Provider, mode: string) {
  try {
    localStorage.setItem(MODE_KEY(provider), mode);
  } catch {
    /* storage unavailable */
  }
}

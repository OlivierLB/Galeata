// Agent actions. In the desktop app they go to the Rust process; in the browser
// preview a recorded, anonymized real session is replayed (clearly labelled demo).
import { desktop, request, subscribe } from '../api.ts';
import { agentStore } from './store.ts';
import type {
  AgentEvent,
  ChatItem,
  Decision,
  PlanAnswer,
  Provider,
  QuestionsAnswer,
  RefuseAnswer,
  ModelOption,
} from './types.ts';
import demo from '../preview/agent-demo.json';
import { readStartMode, writeStartMode } from './preferences.ts';

let listening: Promise<() => void> | null = null;

/** Routes `agent:events` batches to the store (once per app). */
export function listenToAgents() {
  listening ??= subscribe<{ agentId: string; events: AgentEvent[] }>('agent:events', (payload) =>
    agentStore.apply(payload.agentId, payload.events),
  );
  return listening;
}

export async function startAgent(provider: Provider, resumeId?: string, mode?: string): Promise<string> {
  if (!desktop) return startDemo(provider);
  await listenToAgents();
  const { id } = await request<{ id: string }>('agent.start', {
    provider,
    resumeId,
    mode: mode ?? readStartMode(provider),
  });
  // Events that arrived before this point are buffered by the store and replayed.
  if (!agentStore.get(id)) agentStore.create(id, provider);
  void request('agent.models', { id }).catch((error) =>
    agentStore.apply(id, [{ type: 'error', message: String(error) }]),
  );
  return id;
}

export async function sendToAgent(id: string, text: string) {
  agentStore.sending(id);
  agentStore.addUser(id, text);
  if (agentStore.get(id)?.demo) {
    agentStore.apply(id, [{ type: 'turnStarted' }, { type: 'state', state: 'working' }]);
    void demoTurn(id).catch((error) => {
      agentStore.sendFailed(id);
      agentStore.apply(id, [{ type: 'error', message: String(error) }]);
    });
    return;
  }
  try {
    await request('agent.send', { id, text });
  } catch (error) {
    agentStore.sendFailed(id);
    throw error;
  }
}

agentStore.setQueueSender(sendToAgent);

export async function respondToAgent(id: string, requestId: string, decision: Decision) {
  if (agentStore.get(id)?.demo) return demoRespond(id, requestId);
  await request('agent.respond', { id, requestId, decision });
}

export async function answerAgent(
  id: string,
  requestId: string,
  answer: PlanAnswer | QuestionsAnswer | RefuseAnswer,
  status: ChatItem['status'],
  summary?: string,
) {
  agentStore.markAnswered(id, requestId, status, summary);
  if (agentStore.get(id)?.demo) return demoRespond(id, requestId);
  await request('agent.answer', { id, requestId, answer });
}

/**
 * Changes a conversation's mode at the user's request. The choice is remembered
 * for future conversations with the same agent (changes made by the agent itself,
 * such as leaving plan mode, arrive as events and are not remembered).
 */
export async function setAgentMode(id: string, mode: string) {
  const provider = agentStore.get(id)?.provider;
  // The demo has no agent: the mode is only shown.
  if (agentStore.get(id)?.demo) agentStore.apply(id, [{ type: 'mode', mode }]);
  else await request('agent.mode', { id, mode });
  if (provider) writeStartMode(provider, mode);
}

export async function interruptAgent(id: string) {
  agentStore.pauseQueue(id, true);
  if (agentStore.get(id)?.demo) return;
  await request('agent.interrupt', { id });
}

export interface SkillOption {
  name: string;
  description: string;
  path: string;
}

export async function listAgentSkills(provider: Provider): Promise<SkillOption[]> {
  if (!desktop)
    return [
      {
        name: 'review',
        description: 'Relire les modifications du projet (démo)',
        path: '.agents/skills/review/SKILL.md',
      },
    ];
  return request<SkillOption[]>('agent.skills', { provider });
}

export async function compactAgent(id: string) {
  if (agentStore.get(id)?.demo) {
    agentStore.apply(id, [
      { type: 'notice', message: 'Démonstration : le contexte serait compacté ici.' },
    ]);
    return;
  }
  agentStore.sending(id);
  try {
    await request('agent.compact', { id });
  } catch (error) {
    agentStore.sendFailed(id);
    throw error;
  }
}

export async function setAgentModel(id: string, model: string) {
  if (agentStore.get(id)?.demo) {
    agentStore.apply(id, [{ type: 'model', model }]);
    return;
  }
  await request('agent.model', { id, model });
}

export async function closeAgent(id: string) {
  const conversation = agentStore.get(id);
  agentStore.remove(id);
  if (conversation && !conversation.demo) await request('agent.close', { id });
}

// ---- Browser preview: replay of a captured session -------------------------

interface DemoState {
  turn: number;
  waiting: { requestId: string; resume: () => void } | null;
}
const demos = new Map<string, DemoState>();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const demoModels: Record<Provider, ModelOption[]> = {
  claude: [
    { id: 'demo-sonnet', label: 'Sonnet (démo)', description: 'Modèle simulé dans l’aperçu.' },
    { id: 'demo-opus', label: 'Opus (démo)', description: 'Modèle simulé dans l’aperçu.' },
  ],
  codex: [
    { id: 'demo-codex', label: 'Codex (démo)', description: 'Modèle simulé dans l’aperçu.' },
    {
      id: 'demo-codex-fast',
      label: 'Codex rapide (démo)',
      description: 'Modèle simulé dans l’aperçu.',
    },
  ],
};

function startDemo(provider: Provider): string {
  const id = `demo-${crypto.randomUUID()}`;
  agentStore.create(id, provider, true);
  demos.set(id, { turn: 0, waiting: null });
  agentStore.apply(id, [
    { type: 'state', state: 'idle' },
    { type: 'mode', mode: readStartMode(provider) },
    { type: 'models', models: demoModels[provider] },
    { type: 'model', model: demoModels[provider][0].id },
  ]);
  return id;
}

async function demoTurn(id: string) {
  const state = demos.get(id);
  if (!state) return;
  const turns = (demo as { turns: { batches: AgentEvent[][] }[] }).turns;
  const turn = turns[state.turn % turns.length];
  state.turn += 1;
  for (const batch of turn.batches) {
    if (!agentStore.get(id)) return;
    await delay(60);
    agentStore.apply(
      id,
      batch.map((event) =>
        event.type === 'session' ? { ...event, model: agentStore.get(id)?.model ?? null } : event,
      ),
    );
    const approval = batch.find(
      (event) =>
        event.type === 'approval' || event.type === 'planProposal' || event.type === 'question',
    );
    if (approval && 'requestId' in approval) {
      // Wait for the user, like the real agent does.
      await new Promise<void>((resume) => {
        state.waiting = { requestId: approval.requestId, resume };
      });
      // The recorded approvalResolved/state events follow in the next batches.
    }
  }
}

function demoRespond(id: string, requestId: string) {
  const state = demos.get(id);
  if (state?.waiting?.requestId !== requestId) return;
  const { resume } = state.waiting;
  state.waiting = null;
  resume();
}

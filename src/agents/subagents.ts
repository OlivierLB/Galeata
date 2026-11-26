import type { Conversation, ChatItem } from './types.ts';
import type { Activity } from '../types.ts';

export interface Subagent {
  id: string; name: string; prompt: string; status: string; active: boolean;
  tasks: string[]; updates: string[]; result: string;
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
const terminal = /^(completed|done|errored|failed|interrupted|shutdown|notFound|exited)$/;
const labels: Record<string, string> = { running: 'En cours', pendingInit: 'Démarrage', blocked: 'Bloqué',
  completed: 'Terminé', done: 'Terminé', errored: 'En erreur', failed: 'En erreur', interrupted: 'Interrompu',
  shutdown: 'Arrêté', notFound: 'Introuvable' };
const parsed = new WeakMap<ChatItem, Record<string, unknown>>();
function report(item: ChatItem): Record<string, unknown> {
  const cached = parsed.get(item);
  if (cached) return cached;
  let value: Record<string, unknown> = {};
  try { const data = JSON.parse(item.output ?? '{}'); if (data && typeof data === 'object' && !Array.isArray(data)) value = data; } catch { /* Textual Claude result. */ }
  parsed.set(item, value);
  return value;
}

/** Only the selected conversation's tool calls and explicitly related reports. */
export function conversationSubagents(conversation: Conversation, events: Activity[], scoped = false): Subagent[] {
  const agents = new Map<string, Subagent>();
  const roots = new Set([conversation.id, conversation.sessionId].filter(Boolean));
  const ensure = (id: string) => {
    let agent = agents.get(id);
    if (!agent) { agent = { id, name: id, prompt: '', status: 'État non transmis', active: true, tasks: [], updates: [], result: '' }; agents.set(id, agent); }
    return agent;
  };
  for (const item of conversation.items) {
    if (item.kind !== 'tool' || item.tool !== 'agent') continue;
    const data = report(item), input = item.input ?? {};
    const action = text(input.action) || text(data.action) || item.title || '';
    const states = data.agents && typeof data.agents === 'object' && !Array.isArray(data.agents) ? data.agents as Record<string, unknown> : {};
    const destinations = [input.destinations, data.destinations].flatMap(value => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
    const direct = text(data.agent_id) || text(data.agentId) || item.output?.match(/agentId\s*[:=]\s*([\w-]+)/i)?.[1];
    const ids = [...new Set([...Object.keys(states), ...destinations, ...(direct ? [direct] : [])])].filter(id => !roots.has(id));
    const spawn = /spawn/i.test(action) || (conversation.provider === 'claude' && !!input.prompt);
    if (!ids.length && spawn) ids.push(`call:${item.id}`);
    for (const id of ids) {
      const agent = ensure(id);
      if (spawn) {
        agent.name = text(input.name) || text(input.description) || agent.name;
        if (!agent.prompt) agent.prompt = text(input.prompt) || text(input.message);
        if (conversation.provider === 'claude' && !input.run_in_background && !item.running) {
          agent.active = false; agent.status = item.ok === false ? 'En erreur' : 'Terminé';
        } else if (item.running || conversation.provider === 'codex') { agent.active = true; agent.status = 'En cours'; }
      }
      const state = states[id];
      if (state && typeof state === 'object') {
        const status = text((state as Record<string, unknown>).status);
        if (status) { agent.active = !terminal.test(status); agent.status = labels[status] ?? status; }
        const message = text((state as Record<string, unknown>).message);
        if (message) agent.result = message;
      }
      const message = text(input.message) || (!spawn ? text(input.prompt) : '');
      if (message) agent.updates.push(message);
      if (item.output) agent.result = agent.result || item.output;
    }
  }
  // Follow explicit ancestry; unowned historical project missions are excluded.
  const relevant = new Set<string>(roots as Set<string>);
  if (scoped) for (const event of events) {
    if (event.kind === 'activity' && !event.data.parentId && typeof event.data.sessionId === 'string') { relevant.add(event.data.sessionId); if (!agents.has(event.data.sessionId)) roots.add(event.data.sessionId); }
  }
  agents.forEach((_, id) => relevant.add(id));
  let changed = true;
  const ordered = [...events].sort((a, b) => a.createdAt - b.createdAt);
  while (changed) {
    changed = false;
    for (const event of ordered) {
      const id = text(event.data.sessionId), parent = text(event.data.parentId);
      if (event.kind === 'activity' && id && !roots.has(id) && (relevant.has(parent) || agents.has(id)) && !relevant.has(id)) {
        relevant.add(id); changed = true;
      }
    }
  }
  for (const event of ordered) {
    const id = text(event.data.sessionId);
    if (event.kind !== 'activity' || !relevant.has(id) || roots.has(id)) continue;
    const agent = ensure(id), status = text(event.data.status);
    agent.status = labels[status] ?? (status || agent.status);
    agent.active = !terminal.test(status);
    agent.name = text(event.data.name) || agent.name;
    agent.tasks = Array.isArray(event.data.tasks) ? event.data.tasks.filter((task): task is string => typeof task === 'string') : event.message ? [event.message] : [];
    agent.updates.push(event.message);
    if (!agent.prompt) agent.prompt = text(event.data.initialPrompt);
  }
  return [...agents.values()];
}

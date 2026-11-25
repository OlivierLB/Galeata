import type { AgentEvent, ToolKind } from '../agents/types.ts';
import { reactions, type AnimationName, type MascotAction } from './animations.ts';

export interface MascotSnapshot {
  animation: AnimationName;
  label: string;
}
type Delay = (callback: () => void, ms: number) => () => void;
type AgentMood = {
  active: boolean;
  base: MascotSnapshot;
  tools: Map<string, ToolKind>;
  requests: Map<string, MascotSnapshot>;
};
type Pulse = { snapshot: MascotSnapshot; cancel: () => void; action?: MascotAction };
const idle: MascotSnapshot = { animation: 'idle', label: 'Prête à aider' };
const thinking: MascotSnapshot = { animation: 'thinking', label: 'Je réfléchis…' };
const responding: MascotSnapshot = { animation: 'responding', label: 'Je réponds…' };
const working: MascotSnapshot = { animation: 'working', label: 'Au travail !' };
const waiting: MascotSnapshot = { animation: 'waiting', label: 'À toi de jouer' };
const writing: MascotSnapshot = { animation: 'responding', label: 'L’IA modifie un fichier' };
const exploring: MascotSnapshot = { animation: 'thinking', label: 'L’IA explore le projet' };
const question: MascotSnapshot = { animation: 'waiting', label: 'Une IA attend ta réponse' };
const approval: MascotSnapshot = { animation: 'waiting', label: 'Une IA attend ton autorisation' };
const proposal: MascotSnapshot = { animation: 'waiting', label: 'Un plan attend ta validation' };
const success: MascotSnapshot = { animation: 'success', label: 'Opération terminée' };
const delay: Delay = (callback, ms) => {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};

/** Small independent store: token streams notify React only when the mood changes. */
export class MascotStore {
  private agents = new Map<string, AgentMood>();
  private pulses = new Map<string, Pulse>();
  private snapshots = new Map<string, MascotSnapshot>();
  private listeners = new Set<() => void>();
  private operations = new Map<symbol, MascotSnapshot>();
  private delay: Delay;

  constructor(schedule: Delay = delay) {
    this.delay = schedule;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get = (agentId = '') => this.snapshots.get(agentId) ?? idle;

  /** The single navigation mascot also sees requests from background conversations. */
  getOverview = (preferredId = ''): MascotSnapshot => {
    const snapshots = [...this.snapshots.values()];
    const pending = snapshots.find((snapshot) => snapshot.animation === 'waiting');
    if (pending) return pending;
    const failed = snapshots.find((snapshot) => snapshot.animation === 'error');
    if (failed) return failed;
    const operation = [...this.operations.values()].at(-1);
    if (operation) return operation;
    const global = this.pulses.get('');
    if (global && global.snapshot.animation !== 'idle') return global.snapshot;
    const preferred = this.get(preferredId);
    if (preferred.animation !== 'idle') return preferred;
    for (const animation of [
      'working',
      'responding',
      'thinking',
      'goal',
      'step',
      'success',
    ] as const) {
      const active = snapshots.find((snapshot) => snapshot.animation === animation);
      if (active) return active;
    }
    return global?.snapshot ?? idle;
  };

  /** Lives until the actual promise finishes; concurrent tasks have independent handles. */
  begin(snapshot: MascotSnapshot, completed: MascotSnapshot = success) {
    this.pulses.get('')?.cancel();
    this.pulses.delete('');
    const id = Symbol('mascot-operation');
    this.operations.set(id, snapshot);
    this.publish(true);
    return (outcome: 'success' | 'error' = 'success') => {
      if (!this.operations.delete(id)) return;
      const result = outcome === 'error' ? reactions.error : completed;
      this.pulse('', result, outcome === 'error' ? reactions.error.duration : 1800);
      this.publish(true);
    };
  }

  private mood(id: string): AgentMood {
    let mood = this.agents.get(id);
    if (!mood) {
      mood = { active: false, base: idle, tools: new Map(), requests: new Map() };
      this.agents.set(id, mood);
    }
    return mood;
  }

  private publish(force = false) {
    let changed = force;
    for (const id of new Set([
      '',
      ...this.agents.keys(),
      ...this.pulses.keys(),
      ...this.snapshots.keys(),
    ])) {
      const mood = this.agents.get(id);
      const pendingPulse = this.pulses.get(id);
      const pulse = pendingPulse?.action === 'text-edit' && mood?.active ? undefined : pendingPulse;
      const global = id ? this.pulses.get('') : undefined;
      const tools = mood?.tools;
      const toolMood = tools?.size
        ? [...tools.values()].includes('fileEdit')
          ? writing
          : [...tools.values()].every((tool) => tool === 'fileRead' || tool === 'search')
            ? exploring
            : working
        : undefined;
      const next = mood?.requests.size
        ? mood.requests.values().next().value ?? waiting
        : mood?.base.animation === 'waiting'
          ? waiting
          : pulse?.snapshot.animation === 'error'
            ? pulse.snapshot
            : global && !(global.action === 'text-edit' && mood?.active)
              ? global.snapshot
              : pulse?.snapshot ?? toolMood ?? mood?.base ?? idle;
      const previous = this.get(id);
      if (next.animation !== previous.animation || next.label !== previous.label) {
        this.snapshots.set(id, next);
        changed = true;
      }
    }
    if (changed) for (const listener of this.listeners) listener();
  }

  private pulse(id: string, snapshot: MascotSnapshot, duration: number, action?: MascotAction) {
    this.pulses.get(id)?.cancel();
    const pulse: Pulse = { snapshot, action, cancel: () => {} };
    pulse.cancel = this.delay(() => {
      if (this.pulses.get(id) !== pulse) return;
      this.pulses.delete(id);
      this.publish();
    }, duration);
    this.pulses.set(id, pulse);
  }

  /** Reusable entry point for application actions, optionally scoped to one conversation. */
  react(action: MascotAction, agentId = '') {
    const reaction = reactions[action];
    this.pulse(agentId, reaction, reaction.duration, action);
    this.publish();
  }

  /** Only live turns animate tools/text: replaying an old transcript remains calm. */
  onAgentEvents(id: string, events: AgentEvent[]) {
    const mood = this.mood(id);
    for (const event of events) {
      switch (event.type) {
        case 'turnStarted':
          this.pulses.get(id)?.cancel();
          this.pulses.delete(id);
          mood.active = true;
          mood.tools.clear();
          mood.requests.clear();
          mood.base = thinking;
          break;
        case 'textDelta':
        case 'message':
          if (mood.active) mood.base = responding;
          break;
        case 'reasoning':
          if (mood.active) mood.base = thinking;
          break;
        case 'toolStarted':
          if (mood.active) {
            mood.tools.set(event.itemId, event.tool);
            mood.base = thinking;
          }
          break;
        case 'toolCompleted':
          mood.tools.delete(event.itemId);
          if (mood.active && !event.ok) this.pulse(id, reactions.error, reactions.error.duration);
          break;
        case 'approval':
        case 'question':
        case 'planProposal':
          if (mood.active)
            mood.requests.set(
              event.requestId,
              event.type === 'question'
                ? question
                : event.type === 'planProposal'
                  ? proposal
                  : approval,
            );
          break;
        case 'approvalResolved':
          mood.requests.delete(event.requestId);
          break;
        case 'turnCompleted':
          mood.active = false;
          mood.base = idle;
          mood.tools.clear();
          mood.requests.clear();
          if (event.status === 'completed')
            this.pulse(id, { animation: 'success', label: 'Réponse terminée' }, 2400);
          else if (event.status === 'failed')
            this.pulse(id, reactions.error, reactions.error.duration);
          break;
        case 'error':
          this.pulse(id, reactions.error, reactions.error.duration);
          break;
        case 'exited':
          mood.active = false;
          mood.base = idle;
          mood.tools.clear();
          mood.requests.clear();
          if (event.code !== null && event.code !== 0)
            this.pulse(id, reactions.error, reactions.error.duration);
          break;
        case 'state':
          if (event.state === 'starting')
            mood.base = { animation: 'thinking', label: 'Démarrage…' };
          else if (event.state === 'waitingApproval' && mood.active && !mood.requests.size)
            mood.base = waiting;
          else if (event.state === 'working' && mood.base.animation === 'waiting')
            mood.base = thinking;
          else if (event.state === 'idle' && !mood.active) mood.base = idle;
          break;
      }
    }
    this.publish();
  }

  remove(id: string) {
    const changed = this.snapshots.has(id);
    this.pulses.get(id)?.cancel();
    this.pulses.delete(id);
    this.agents.delete(id);
    this.snapshots.delete(id);
    this.publish(changed);
  }

  clear() {
    for (const pulse of this.pulses.values()) pulse.cancel();
    this.pulses.clear();
    const hadOperations = this.operations.size > 0;
    this.operations.clear();
    this.agents.clear();
    const changed = hadOperations || this.snapshots.size > 0;
    this.snapshots.clear();
    if (changed) for (const listener of this.listeners) listener();
  }
}

export const mascot = new MascotStore();

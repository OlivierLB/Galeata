// Conversation store kept outside React state.
//
// Performance: events arrive in batches from the desktop process; each batch
// replaces only the conversation and the items it touches (copy-on-write), so
// memoized item views re-render only when their own item changed. Listeners are
// notified at most once per animation frame, whatever the event rate.
import type { AgentEvent, ChatItem, Conversation, Provider } from './types.ts';
import { mascot } from '../mascot/store.ts';

const MAX_OUTPUT = 256 * 1024;

type Listener = () => void;

const schedule: (callback: () => void) => void =
  typeof requestAnimationFrame === 'function'
    ? (callback) => requestAnimationFrame(() => callback())
    : (callback) => queueMicrotask(callback);

function keepTail(text: string): string {
  return text.length > MAX_OUTPUT ? text.slice(text.length - MAX_OUTPUT) : text;
}

export class AgentStore {
  private conversations = new Map<string, Conversation>();
  private positions = new Map<string, Map<string, number>>();
  private order: string[] = [];
  private listeners = new Set<Listener>();
  private pending = false;
  private sequence = 0;
  private list: Conversation[] = [];
  /** Events received before `create` (the process can answer before the UI knows its id). */
  private early = new Map<string, AgentEvent[]>();
  // Composer state survives chat remounts without notifying every subscriber on typing.
  private drafts = new Map<string, string>();

  getDraft(id: string): string {
    return this.drafts.get(id) ?? '';
  }

  setDraft(id: string, text: string) {
    if (text && this.conversations.has(id)) this.drafts.set(id, text);
    else this.drafts.delete(id);
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stable array, replaced only when a conversation changed. */
  getAll = () => this.list;

  get(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  create(id: string, provider: Provider, demo = false) {
    this.conversations.set(id, {
      id,
      provider,
      demo,
      state: 'starting',
      busy: false,
      items: [],
      approvals: [],
      costUsd: 0,
      models: [],
    });
    this.positions.set(id, new Map());
    this.order.push(id);
    const early = this.early.get(id);
    this.early.delete(id);
    if (early) this.apply(id, early);
    else this.changed();
  }

  remove(id: string) {
    mascot.remove(id);
    this.drafts.delete(id);
    this.conversations.delete(id);
    this.positions.delete(id);
    this.order = this.order.filter((value) => value !== id);
    this.changed();
  }

  clear() {
    mascot.clear();
    this.drafts.clear();
    this.conversations.clear();
    this.positions.clear();
    this.order = [];
    this.changed();
  }

  /** Records locally how a plan or question was answered (before the agent confirms). */
  markAnswered(id: string, itemId: string, status: ChatItem['status'], answer?: string) {
    const conversation = this.conversations.get(id);
    const position = this.positions.get(id)?.get(itemId);
    if (!conversation || position === undefined) return;
    const items = conversation.items.slice();
    items[position] = { ...items[position], status, answer };
    this.conversations.set(id, { ...conversation, items });
    this.changed();
  }

  addUser(id: string, text: string) {
    this.apply(id, [], [{ id: `user-${++this.sequence}`, kind: 'user', text }]);
  }

  apply(id: string, events: AgentEvent[], extra: ChatItem[] = []) {
    const current = this.conversations.get(id);
    const positions = this.positions.get(id);
    if (!current || !positions) {
      const buffered = this.early.get(id) ?? [];
      if (buffered.length < 1000) this.early.set(id, buffered.concat(events));
      return;
    }
    const next: Conversation = { ...current };
    let items: ChatItem[] | null = null;
    const writable = () => (items ??= current.items.slice());
    const upsert = (
      itemId: string,
      create: () => ChatItem,
      update: (item: ChatItem) => ChatItem,
    ) => {
      const list = writable();
      const position = positions.get(itemId);
      if (position === undefined) {
        positions.set(itemId, list.length);
        list.push(update(create()));
      } else {
        list[position] = update(list[position]);
      }
    };
    const push = (item: Omit<ChatItem, 'id'>) => {
      const list = writable();
      const itemId = `local-${++this.sequence}`;
      positions.set(itemId, list.length);
      list.push({ id: itemId, ...item });
    };
    for (const item of extra) push(item);
    for (const event of events) {
      switch (event.type) {
        case 'models':
          next.models = event.models;
          break;
        case 'model':
          next.model = event.model;
          break;
        case 'session':
          next.sessionId = event.sessionId;
          next.model = event.model;
          break;
        case 'state':
          next.state = event.state;
          break;
        case 'turnStarted':
          next.busy = true;
          next.turnDiff = undefined;
          break;
        case 'turnCompleted':
          next.busy = false;
          next.costUsd += event.costUsd ?? 0;
          if (event.status === 'failed')
            push({ kind: 'error', text: event.error ?? 'Le tour a échoué.' });
          else if (event.status === 'interrupted')
            push({ kind: 'notice', text: 'Tour interrompu.' });
          break;
        case 'userMessage':
          upsert(
            event.itemId,
            () => ({ id: event.itemId, kind: 'user', text: '' }),
            (item) => ({ ...item, text: event.text }),
          );
          break;
        case 'textDelta':
          upsert(
            event.itemId,
            () => ({ id: event.itemId, kind: 'assistant', text: '', streaming: true }),
            (item) => ({ ...item, text: item.text + event.text }),
          );
          break;
        case 'message':
          upsert(
            event.itemId,
            () => ({ id: event.itemId, kind: 'assistant', text: '' }),
            (item) => ({ ...item, text: event.text, streaming: false }),
          );
          break;
        case 'reasoning':
          upsert(
            event.itemId,
            () => ({ id: event.itemId, kind: 'reasoning', text: '' }),
            (item) => ({ ...item, text: event.text }),
          );
          break;
        case 'toolStarted':
          upsert(
            event.itemId,
            () => ({ id: event.itemId, kind: 'tool', text: '' }),
            (item) => ({
              ...item,
              tool: event.tool,
              title: event.title,
              path: event.path,
              running: true,
            }),
          );
          break;
        case 'toolOutput':
          upsert(
            event.itemId,
            () => ({ id: event.itemId, kind: 'tool', text: '', running: true, tool: 'other' }),
            (item) => ({ ...item, output: keepTail((item.output ?? '') + event.text) }),
          );
          break;
        case 'toolCompleted':
          upsert(
            event.itemId,
            () => ({ id: event.itemId, kind: 'tool', text: '', tool: 'other' }),
            (item) => ({
              ...item,
              running: false,
              ok: event.ok,
              output: event.output ?? item.output,
            }),
          );
          break;
        case 'fileChanges':
          upsert(
            event.itemId,
            () => ({ id: event.itemId, kind: 'tool', text: '', tool: 'fileEdit' }),
            (item) => ({ ...item, changes: event.changes }),
          );
          break;
        case 'mode':
          next.mode = event.mode;
          break;
        case 'turnDiff':
          next.turnDiff = event.diff;
          break;
        case 'approval':
          next.approvals = [
            ...next.approvals.filter((approval) => approval.requestId !== event.requestId),
            {
              requestId: event.requestId,
              kind: event.kind,
              title: event.title,
              detail: event.detail,
              description: event.description,
              always: event.always,
            },
          ];
          break;
        case 'planProposal':
          upsert(
            event.requestId,
            () => ({ id: event.requestId, kind: 'plan', text: '' }),
            (item) => ({
              ...item,
              text: event.plan,
              path: event.path,
              requestId: event.requestId,
              status: 'pending',
            }),
          );
          break;
        case 'plan':
          upsert(
            event.itemId,
            () => ({ id: event.itemId, kind: 'plan', text: '' }),
            // A plan without a request (Codex, history): it can be put into action.
            (item) => ({ ...item, text: event.text, status: item.status ?? 'ready' }),
          );
          break;
        case 'question':
          upsert(
            event.requestId,
            () => ({ id: event.requestId, kind: 'question', text: '' }),
            (item) => ({
              ...item,
              questions: event.questions,
              requestId: event.requestId,
              status: 'pending',
            }),
          );
          break;
        case 'approvalResolved': {
          next.approvals = next.approvals.filter(
            (approval) => approval.requestId !== event.requestId,
          );
          const position = positions.get(event.requestId);
          const list = items ?? current.items;
          if (position !== undefined && list[position]?.status === 'pending')
            upsert(
              event.requestId,
              () => list[position],
              (item) => ({ ...item, status: 'closed' }),
            );
          break;
        }
        case 'usage':
          next.usage = {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            contextWindow: event.contextWindow,
          };
          break;
        case 'notice':
          push({ kind: 'notice', text: event.message });
          break;
        case 'error':
          push({ kind: 'error', text: event.message });
          break;
        case 'exited':
          next.state = 'exited';
          next.busy = false;
          next.approvals = [];
          next.exit = { code: event.code, stderr: event.stderr };
          if (event.code !== 0 && event.code !== null)
            push({
              kind: 'error',
              text: `L’agent s’est arrêté (code ${event.code}).${event.stderr ? `\n${event.stderr}` : ''}`,
            });
          break;
      }
    }
    if (items) next.items = items;
    this.conversations.set(id, next);
    mascot.onAgentEvents(id, events);
    this.changed();
  }

  private changed() {
    this.list = this.order
      .map((id) => this.conversations.get(id))
      .filter((value): value is Conversation => !!value);
    if (this.pending) return;
    this.pending = true;
    schedule(() => {
      this.pending = false;
      for (const listener of this.listeners) listener();
    });
  }
}

export const agentStore = new AgentStore();

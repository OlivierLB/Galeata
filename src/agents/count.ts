import type { ChatItem, Conversation } from './types.ts';
import type { Activity } from '../types.ts';

const reports = new WeakMap<ChatItem, { found: Set<string>; action: string }>();
function delegation(item: ChatItem) {
  const cached = reports.get(item);
  if (cached) return cached;
  const found = new Set<string>();
  let action = '';
  try {
    const report = JSON.parse(item.output ?? '{}');
    action = typeof report.action === 'string' ? report.action : '';
    if (report.agents && typeof report.agents === 'object' && !Array.isArray(report.agents))
      Object.keys(report.agents).forEach(id => found.add(id));
    if (Array.isArray(report.destinations))
      report.destinations.filter((id: unknown) => typeof id === 'string').forEach((id: string) => found.add(id));
    if (typeof report.agent_id === 'string') found.add(report.agent_id);
    if (typeof report.agentId === 'string') found.add(report.agentId);
  } catch { /* Claude may return a textual agent id instead of JSON. */ }
  const match = item.output?.match(/agentId\s*[:=]\s*([\w-]+)/i);
  if (match) found.add(match[1]);
  const report = { found, action };
  reports.set(item, report);
  return report;
}

/** Count identities, never repeated wait/send calls or mission updates. */
export function countAgents(conversations: Conversation[], events: Activity[]) {
  const roots = new Set(conversations.flatMap(c => [c.id, ...(c.sessionId ? [c.sessionId] : [])]));
  const children = new Set<string>();
  const owner = new Map(conversations.flatMap(c => [c.id, ...(c.sessionId ? [c.sessionId] : [])].map(id => [id, c.id] as const)));
  const anonymous = new Map<string, Set<string>>();
  for (const conversation of conversations) {
    for (const item of conversation.items) {
      if (item.kind !== 'tool' || item.tool !== 'agent') continue;
      const { found, action } = delegation(item);
      found.forEach(id => { children.add(id); if (!owner.has(id)) owner.set(id, conversation.id); });
      // Claude's Agent/Task tool creates one child. Codex control calls do not.
      if (!found.size && item.ok !== false && (conversation.provider === 'claude' || /spawn/i.test(action || item.title || '')))
        anonymous.set(conversation.id, new Set([...(anonymous.get(conversation.id) ?? []), item.id]));
    }
  }
  const toolChildren = new Set(children);
  const latest = new Map<string, Activity>();
  for (const event of events) {
    if (event.kind !== 'activity' || typeof event.data.sessionId !== 'string') continue;
    const previous = latest.get(event.data.sessionId);
    if (!previous || previous.createdAt <= event.createdAt) latest.set(event.data.sessionId, event);
  }
  // Traverse declared descendants, ignoring unrelated historical project missions.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, event] of latest) {
      const parent = event.data.parentId;
      if (typeof parent === 'string' && (roots.has(parent) || children.has(parent)) && !roots.has(id) && !children.has(id)) {
        children.add(id); owner.set(id, owner.get(parent)!); changed = true;
      }
    }
  }
  roots.forEach(id => children.delete(id));
  roots.forEach(id => toolChildren.delete(id));
  // Declarations without a corresponding tool id may describe anonymous spawns.
  // Reconcile per conversation so one provider cannot hide another one's workers.
  let subagents = toolChildren.size;
  for (const conversation of conversations) {
    const declaredOnly = [...children].filter(id => !toolChildren.has(id) && owner.get(id) === conversation.id).length;
    subagents += Math.max(declaredOnly, anonymous.get(conversation.id)?.size ?? 0);
  }
  return { tabs: conversations.length, subagents, total: conversations.length + subagents };
}

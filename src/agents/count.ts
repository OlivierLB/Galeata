import type { Conversation } from './types.ts';
import type { Activity } from '../types.ts';
import { conversationSubagents } from './subagents.ts';

/** Use the same live identities and terminal states as the subagent list. */
export function countAgents(conversations: Conversation[], events: Activity[]) {
  const children = new Set<string>();
  const roots = new Set(conversations.flatMap(c => [c.id, ...(c.sessionId ? [c.sessionId] : [])]));
  let tabs = 0;
  for (const conversation of conversations) {
    if (conversation.state === 'exited') continue;
    if (conversation.busy || conversation.state === 'starting' || conversation.state === 'working' || conversation.state === 'waitingApproval') tabs++;
    for (const child of conversationSubagents(conversation, events))
      if (child.active && !roots.has(child.id)) children.add(child.id);
  }
  return { tabs, subagents: children.size, total: tabs + children.size };
}

import { useCallback, useSyncExternalStore } from 'react';
import { agentStore } from '../agents/store.ts';
import { countAgents } from '../agents/count.ts';
import type { Activity } from '../types.ts';
import { CountBadge } from './CountBadge.tsx';

export default function AgentCountBadge({ events }: { events: Activity[] }) {
  const snapshot = useCallback(() => countAgents(agentStore.getAll(), events).total, [events]);
  const total = useSyncExternalStore(agentStore.subscribe, snapshot);
  return total ? <CountBadge count={total} label="onglets et sous-agents" placement="navigation" /> : null;
}

import { useEffect, useRef, useState } from 'react';
import { normalizeLayout, reconcileLayout } from '../agents/layout.ts';
import { readProjectSession, saveProjectSession } from '../projectSession.ts';

export function useConversationLayout(ids: string[], workspaceId: string | undefined, onError: (error: unknown) => void) {
  const [layout, setLayout] = useState(() => normalizeLayout(
    workspaceId ? readProjectSession(workspaceId).conversationLayout : undefined, ids,
  ));
  const previousIds = useRef(ids);
  useEffect(() => {
    const previous = previousIds.current;
    previousIds.current = ids;
    if (previous.length === ids.length && previous.every(id => ids.includes(id))) return;
    setLayout(value => reconcileLayout(value, previous, ids));
  }, [ids]);
  useEffect(() => {
    if (!workspaceId) return;

    try { saveProjectSession(workspaceId, { conversationLayout: {
      active: layout.active, right: '', split: false, pairs: [],
    } }); } catch (error) { onError(error); }
  }, [workspaceId, layout, onError]);

  return {
    active: layout.active,
    select: (id: string) => setLayout(value => ({ ...value, active: id })),

  };
}

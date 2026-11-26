import { useCallback, useEffect, useRef, useState } from 'react';
import { request, subscribe } from '../api.ts';
import type { CheckRun } from './types.ts';

/** Event-driven snapshots, with a trailing refresh so fast exits cannot be lost. */
export function useCheckRuns(workspaceId?: string, enabled = true, includeHistory = true) {
  const [runs, setRuns] = useState<CheckRun[]>([]);
  const [error, setError] = useState('');
  const loader = useRef<(history?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    setRuns([]);
    if (!workspaceId || !enabled) return;
    let disposed = false;
    let dirty = false;
    let historyRequested = false;
    let pending: Promise<void> | null = null;
    const cleanups: (() => void)[] = [];
    const load = (history = false): Promise<void> => {
      dirty = true;
      historyRequested ||= history;
      if (pending) return pending;
      pending = (async () => {
        while (dirty && !disposed) {
          dirty = false;
          const refresh = historyRequested;
          historyRequested = false;
          try {
            const value = await request<CheckRun[]>('checks.status', { refresh });
            if (disposed) break;
            setError('');
            setRuns(previous => refresh ? value : [...value, ...previous.filter(old => !value.some(run => run.id === old.id))].slice(0, 8));
          } catch (reason) { if (!disposed) setError(String(reason)); }
        }
      })().finally(() => { pending = null; });
      return pending;
    };
    loader.current = load;
    void load(includeHistory);
    for (const name of ['checks:changed', 'workspace:changed']) {
      void subscribe<{ workspaceId: string }>(name, event => {
        if (event.workspaceId === workspaceId) void load();
      }).then(clean => { if (disposed) clean(); else cleanups.push(clean); })
        .catch(reason => { if (!disposed) setError(String(reason)); });
    }
    return () => { disposed = true; loader.current = async () => {}; cleanups.forEach(clean => clean()); };
  }, [workspaceId, enabled, includeHistory]);
  const refresh = useCallback((history = true) => loader.current(history), []);
  return { runs, error, refresh };
}

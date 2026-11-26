import { useEffect, useState } from 'react';
import { readProjectSession, saveProjectSession } from '../projectSession.ts';
import { request } from '../api.ts';
import type { Entry } from '../types.ts';
import { Icon } from './Icon.tsx';

export function FileTree({
  workspaceId,
  revision,
  selected,
  onOpen,
  onError,
}: {
  workspaceId: string;
  revision: number;
  selected: string;
  onOpen: (path: string) => void;
  onError: (error: unknown) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const saved = readProjectSession(workspaceId).expanded;
    return new Set(Array.isArray(saved) ? saved.filter(path => typeof path === 'string') : ['src']);
  });
  const toggle = (path: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(path)) next.delete(path); else next.add(path);
    try { saveProjectSession(workspaceId, { expanded: [...next] }); } catch (error) { onError(error); }
    return next;
  });
  return (
    <div className="file-tree" role="tree" aria-label="Fichiers du projet">
      <Directory
        key={workspaceId}
        expanded={expanded} onToggle={toggle}
        path=""
        depth={0}
        revision={revision}
        selected={selected}
        onOpen={onOpen}
        onError={onError}
      />
    </div>
  );
}
function Directory({
  expanded, onToggle,
  path,
  depth,
  revision,
  selected,
  onOpen,
  onError,
}: {
  expanded: Set<string>; onToggle: (path: string) => void;
  path: string;
  depth: number;
  revision: number;
  selected: string;
  onOpen: (path: string) => void;
  onError: (error: unknown) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let current = true;
    setLoading(true);
    void request<{ items: Entry[]; nextOffset: number | null }>('workspace.list', { path })
      .then((result) => {
        if (current) {
          setEntries(result.items);
          setNextOffset(result.nextOffset);
        }
      })
      .catch((error) => {
        if (current) onError(error);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path, revision, onError]);
  async function more() {
    try {
      const result = await request<{ items: Entry[]; nextOffset: number | null }>(
        'workspace.list',
        { path, offset: nextOffset },
      );
      setEntries((previous) => [...previous, ...result.items]);
      setNextOffset(result.nextOffset);
    } catch (error) {
      onError(error);
    }
  }
  return (
    <>
      {loading && !entries.length ? <p className="muted tree-loading">Chargement…</p> : null}
      {entries.map((entry) => (
        <div key={entry.path} role="none">
          <button
            role="treeitem"
            aria-expanded={entry.directory ? expanded.has(entry.path) : undefined}
            aria-selected={selected === entry.path}
            className={`tree-entry ${selected === entry.path ? 'selected' : ''}`}
            style={{ paddingLeft: 12 + depth * 15 }}
            onClick={() =>
              entry.directory
                ? onToggle(entry.path)
                : onOpen(entry.path)
            }
            title={entry.path}
          >
            {entry.directory ? (
              <Icon
                name="chevron"
                size={12}
                className={expanded.has(entry.path) ? 'rotated' : ''}
              />
            ) : (
              <span className="tree-indent" />
            )}
            {entry.directory ? (
              <Icon name="folder" size={15} className="folder-icon" />
            ) : (
              <span
                className={`file-type ${entry.name.endsWith('.rs') ? 'rust' : entry.name.endsWith('.md') ? 'markdown' : ''}`}
              >
                <Icon name={/\.(tsx?|rs|json|css|html)$/.test(entry.name) ? "file-code" : "files"} size={14} />
              </span>
            )}
            <span className="truncate">{entry.name}</span>
            {entry.symlink ? <Icon name="arrow-ne" size={12} className="muted" /> : null}
          </button>
          {entry.directory && expanded.has(entry.path) ? (
            <div role="group">
              <Directory
                expanded={expanded} onToggle={onToggle}
                path={entry.path}
                depth={depth + 1}
                revision={revision}
                selected={selected}
                onOpen={onOpen}
                onError={onError}
              />
            </div>
          ) : null}
        </div>
      ))}
      {nextOffset !== null ? (
        <button className="text-button" onClick={() => void more()}>
          Charger la suite
        </button>
      ) : null}
    </>
  );
}

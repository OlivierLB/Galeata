import { useEffect, useState } from 'react';
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
  return (
    <div className="file-tree" role="tree" aria-label="Fichiers du projet">
      <Directory
        key={workspaceId}
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
  path,
  depth,
  revision,
  selected,
  onOpen,
  onError,
}: {
  path: string;
  depth: number;
  revision: number;
  selected: string;
  onOpen: (path: string) => void;
  onError: (error: unknown) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(depth === 0 ? ['src'] : []));
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
                ? setExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  })
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
                {entry.name.endsWith('.tsx')
                  ? '✳'
                  : entry.name.endsWith('.ts')
                    ? 'TS'
                    : entry.name.endsWith('.rs')
                      ? 'Rs'
                      : entry.name.endsWith('.json')
                        ? '{}'
                        : entry.name.endsWith('.md')
                          ? 'M↓'
                          : '·'}
              </span>
            )}
            <span className="truncate">{entry.name}</span>
            {entry.symlink ? <span className="muted">↗</span> : null}
          </button>
          {entry.directory && expanded.has(entry.path) ? (
            <div role="group">
              <Directory
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

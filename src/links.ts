/** What a click on a link inside an agent message should do. */
export type LinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'file'; path: string; line?: number }
  | null;

const external = /^(https?:\/\/|mailto:)/i;

/**
 * Classifies a markdown link target. Web links open in the system browser;
 * workspace paths (`src/a.ts`, `src/a.ts:12`, `src/a.ts#L12`, or an absolute
 * path under the workspace root) open in the editor. Anything else is ignored.
 */
export function classifyLink(href: string | null | undefined, root?: string): LinkTarget {
  const raw = (href ?? '').trim();
  if (!raw || raw.startsWith('#')) return null;
  if (external.test(raw)) return { kind: 'external', url: raw };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.toLowerCase().startsWith('file:')) return null;
  let path = raw.replace(/^file:\/\//i, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  let line: number | undefined;
  const anchor = /#L(\d+)(?:-L?\d+)?$/.exec(path) ?? /:(\d+)(?:[-–:]\d+)?$/.exec(path);
  if (anchor) {
    line = Number(anchor[1]) || undefined;
    path = path.slice(0, anchor.index);
  }
  path = path.split(/[?#]/)[0];
  if (path.startsWith('/')) {
    const base = root?.replace(/\/+$/, '');
    if (!base || !path.startsWith(`${base}/`)) return null;
    path = path.slice(base.length + 1);
  }
  path = path.replace(/^\.\//, '');
  if (!path || path.split('/').includes('..')) return null;
  return line ? { kind: 'file', path, line } : { kind: 'file', path };
}

/**
 * Reads a file reference written as inline code (`src/a.ts`, `src/a.ts:12`,
 * `src/a.ts:12-20`). Only text shaped like a path with a directory and an
 * extension qualifies, so ordinary code snippets are never treated as files.
 */
export function fileReference(text: string | null | undefined, root?: string): LinkTarget {
  const raw = (text ?? '').trim();
  if (!/^(?:\.?\/)?[\w.@+-]+(?:\/[\w.@+-]+)+\.\w+(?::\d+(?:[-–:]\d+)?)?$/.test(raw)) return null;
  const target = classifyLink(raw, root);
  return target?.kind === 'file' ? target : null;
}

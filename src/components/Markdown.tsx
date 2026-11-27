import { memo, useMemo, type MouseEvent } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getActiveWorkspace, openExternal } from '../api.ts';
import { classifyLink, fileReference } from '../links.ts';

marked.setOptions({ gfm: true, breaks: false, async: false });

/**
 * Sanitized markdown for completed agent messages. Parsing runs once per text
 * (memoized); streaming messages are shown as plain text instead.
 * Links never navigate the app window: web links open in the system browser,
 * workspace paths open in the editor.
 */
export const Markdown = memo(function Markdown({
  text,
  onOpenFile,
}: {
  text: string;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text) as string, { USE_PROFILES: { html: true } }),
    [text],
  );
  const follow = (event: MouseEvent) => {
    const element = event.target as HTMLElement;
    const root = getActiveWorkspace()?.root;
    const anchor = element.closest('a');
    if (anchor) {
      event.preventDefault();
      const target = classifyLink(anchor.getAttribute('href'), root);
      if (target?.kind === 'external') void openExternal(target.url).catch(() => {});
      else if (target?.kind === 'file') onOpenFile?.(target.path, target.line);
      return;
    }
    // Inline code naming a workspace file opens it on Ctrl/Cmd+click,
    // leaving a plain click free for selecting and copying the path.
    if (!onOpenFile || !(event.ctrlKey || event.metaKey)) return;
    const code = element.closest('code');
    if (!code || code.closest('pre')) return;
    const target = fileReference(code.textContent, root);
    if (target?.kind !== 'file') return;
    event.preventDefault();
    onOpenFile(target.path, target.line);
  };
  // Marks file references lazily on hover so the hint costs nothing at render.
  const hint = (event: MouseEvent) => {
    if (!onOpenFile) return;
    const code = (event.target as HTMLElement).closest('code');
    if (!code || code.closest('pre') || code.dataset.file !== undefined) return;
    const isFile = fileReference(code.textContent, getActiveWorkspace()?.root) !== null;
    code.dataset.file = String(isFile);
    if (isFile) code.title = 'Ctrl+clic pour ouvrir dans Fichiers';
  };
  return (
    <div className="markdown" onClick={follow} onMouseOver={hint} dangerouslySetInnerHTML={{ __html: html }} />
  );
});

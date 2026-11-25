import { memo, useMemo, type MouseEvent } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false, async: false });

/**
 * Sanitized markdown for completed agent messages. Parsing runs once per text
 * (memoized); streaming messages are shown as plain text instead.
 * Links never navigate the app window: they are shown, not followed.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text) as string, { USE_PROFILES: { html: true } }),
    [text],
  );
  const block = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('a')) event.preventDefault();
  };
  return <div className="markdown" onClick={block} dangerouslySetInnerHTML={{ __html: html }} />;
});

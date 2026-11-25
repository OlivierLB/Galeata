import { marked, type Token, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import type { Step } from './types.ts';

/**
 * Same cleaning as the Rust extractor (galeata-agent-protocol/src/plan.rs):
 * emphasis, code marks and step numbering are ignored when matching a heading
 * of the plan text to a step of the plan.
 */
export function cleanStepTitle(text: string): string {
  let value = text.replaceAll('**', '').replaceAll('`', '').trim();
  const numbered = /^(?:étape|etape|step)\s*\d+\s*[—–:.)-]?\s*/i.exec(value);
  if (numbered) value = value.slice(numbered[0].length);
  value = value.replace(/^\d+[.)]\s*/, '');
  return value.trim().toLowerCase();
}

export type PlanSection =
  { kind: 'text'; html: string } | { kind: 'step'; step: Step; depth: number; html: string };

/**
 * Splits the plan text into plain sections and step sections (a step heading
 * and its content), so each step can show its state where it is described.
 * The first title is dropped when it repeats the objective.
 */
export function planSections(
  document: string,
  steps: Step[],
  objective: string,
  // DOMPurify needs a DOM; tests running in Node pass their own.
  sanitize: (html: string) => string = (html) => DOMPurify.sanitize(html),
): PlanSection[] {
  const render = (tokens: Token[]) =>
    tokens.length ? sanitize(marked.parser(tokens) as string) : '';
  const tokens = marked.lexer(document);
  const byTitle = new Map(steps.map((step) => [cleanStepTitle(step.title), step]));
  const sections: PlanSection[] = [];
  let buffer: Token[] = [];
  let current: { step: Step; depth: number } | null = null;
  const flush = () => {
    if (current) sections.push({ kind: 'step', ...current, html: render(buffer) });
    else if (buffer.length) sections.push({ kind: 'text', html: render(buffer) });
    buffer = [];
  };
  tokens.forEach((token, index) => {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading;
      if (
        index === tokens.findIndex((t) => t.type === 'heading') &&
        heading.depth === 1 &&
        cleanStepTitle(heading.text).includes(cleanStepTitle(objective).slice(0, 40))
      )
        return;
      const step = byTitle.get(cleanStepTitle(heading.text));
      if (step) {
        flush();
        current = { step, depth: heading.depth };
        return;
      }
      if (current && heading.depth <= current.depth) {
        flush();
        current = null;
      }
    }
    buffer.push(token);
  });
  flush();
  return sections;
}

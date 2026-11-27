#!/usr/bin/env node
// Check repository-local documentation links without network access.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';

export function headingSlug(text) {
  return text.replace(/[<>]/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replaceAll(' ', '-');
}

export function inspectMarkdown(text) {
  const links = [], anchors = new Set(), counts = new Map(), code = [];
  const tokens = marked.lexer(text);
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'heading') {
      const base = headingSlug(token.text);
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      anchors.add(base + (count ? `-${count}` : ''));
    }
    if (token.type === 'link' || token.type === 'image') links.push(token.href);
    if (token.type === 'html') {
      for (const match of token.text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) anchors.add(match[1]);
      for (const match of token.text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) links.push(match[1]);
    }
    if (token.type === 'code' || token.type === 'codespan') code.push([token.type, token.lang ?? '', token.text]);
  });
  return { links, anchors, code };
}

export function checkDocs(root, translations = false) {
  root = resolve(root);
  const docs = resolve(root, 'docs');
  const names = (lang) => readdirSync(resolve(docs, lang)).filter((name) => name.endsWith('.md')).sort();
  const french = names('fr');
  const english = names('en');
  const paths = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CLAUDE.md',
    ...readdirSync(docs).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`),
    ...french.map((name) => `docs/fr/${name}`),
    ...(translations ? english.map((name) => `docs/en/${name}`) : [])];
  const errors = [];
  const parsed = new Map();
  const inspect = (path) => {
    if (!parsed.has(path)) parsed.set(path, inspectMarkdown(readFileSync(path, 'utf8')));
    return parsed.get(path);
  };
  if (translations && JSON.stringify(french) !== JSON.stringify(english)) errors.push('French and English page lists differ');
  for (const name of paths) {
    const path = resolve(root, name);
    const page = inspect(path);
    for (const href of page.links) {
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) continue;
      const [targetPath, fragment] = href.split('#');
      let target;
      try {
        target = resolve(dirname(path), decodeURIComponent(targetPath || ''));
        if (!targetPath) target = path;
        // Source PRs may leave English stale until the publication workflow runs.
        if (!translations && relative(root, target).startsWith('docs/en/')) target = target.replace(/\/docs\/en\//, '/docs/fr/');
        if (relative(root, target).startsWith('..')) throw new Error('outside repository');
        if (!existsSync(target)) throw new Error('missing target');
        if (fragment && extname(target) === '.md' && statSync(target).isFile()
            && !inspect(target).anchors.has(decodeURIComponent(fragment))) throw new Error('missing anchor');
      } catch (error) {
        errors.push(`${name}: ${href} (${error.message})`);
      }
    }
  }
  if (translations) {
    for (const name of french) {
      const fr = inspect(resolve(docs, 'fr', name));
      const enPath = resolve(docs, 'en', name);
      if (existsSync(enPath) && JSON.stringify(fr.code) !== JSON.stringify(inspect(enPath).code)) {
        errors.push(`${name}: translated code blocks or inline code differ`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return paths.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = checkDocs(fileURLToPath(new URL('..', import.meta.url)), process.argv.includes('--translations'));
    console.log(`Documentation: ${count} files checked.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

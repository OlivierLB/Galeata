#!/usr/bin/env node
// Mirrors README.md and docs/*.md into a checked-out GitHub wiki.
// Usage: node scripts/sync-wiki.mjs <repo-root> <wiki-dir> [repo-url]
// Only pages listed in the wiki's .galeata-sync manifest are managed: pages
// written by hand in the wiki are never modified or deleted.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const MANIFEST = '.galeata-sync';

/** Rewrites repository-relative links so they work from the wiki. */
export function rewriteLinks(markdown, sourcePath, pages, repoUrl) {
  const dir = posix.dirname(sourcePath);
  const rewrite = (_, bang, text, target, rest) => {
    if (/^([a-z][\w+.-]*:|#|\/\/)/i.test(target)) return `${bang}[${text}](${target}${rest})`;
    const [path, anchor = ''] = target.split(/(?=#)/);
    const resolved = posix.normalize(posix.join(dir, decodeURI(path)));
    let url;
    if (!bang && resolved === 'README.md') url = 'Home';
    else if (!bang && pages.has(resolved)) url = pages.get(resolved);
    else url = `${repoUrl}/${bang ? 'raw' : 'blob'}/main/${encodeURI(resolved)}`;
    return `${bang}[${text}](${url}${anchor}${rest})`;
  };
  // Leave fenced code blocks untouched.
  return markdown.split(/(^```[\s\S]*?^```)/m).map((part, index) => index % 2
    ? part
    : part.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, rewrite)).join('');
}

const title = (markdown, fallback) => /^#\s+(.+)$/m.exec(markdown)?.[1].trim() ?? fallback;

/** Returns the wiki files (name → content) generated from the repository. */
export function buildWikiPages({ readme, docs, repoUrl }) {
  const pages = new Map(Object.keys(docs).sort().map((name) => [`docs/${name}`, name.replace(/\.md$/, '')]));
  const note = (source) => `\n\n---\n> Page générée depuis [\`${source}\`](${repoUrl}/blob/main/${source}) : modifiez ce fichier dans le dépôt, pas le wiki.\n`;
  const files = new Map([['Home.md', rewriteLinks(readme, 'README.md', pages, repoUrl).trimEnd() + note('README.md')]]);
  const entries = [];
  for (const [source, page] of pages) {
    const content = docs[source.slice('docs/'.length)];
    files.set(`${page}.md`, rewriteLinks(content, source, pages, repoUrl).trimEnd() + note(source));
    entries.push([title(content, page), page]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b, 'fr'));
  files.set('_Sidebar.md', ['**[Accueil](Home)**', '', ...entries.map(([text, page]) => `- [${text}](${page})`), ''].join('\n'));
  return files;
}

/** Writes the generated pages and removes managed pages that no longer exist. */
export function syncWiki(root, wiki, repoUrl) {
  const docs = Object.fromEntries(readdirSync(join(root, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => [name, readFileSync(join(root, 'docs', name), 'utf8')]));
  const files = buildWikiPages({ readme: readFileSync(join(root, 'README.md'), 'utf8'), docs, repoUrl });
  const manifest = join(wiki, MANIFEST);
  const previous = existsSync(manifest) ? readFileSync(manifest, 'utf8').split('\n').filter(Boolean) : [];
  const removed = previous.filter((name) => !files.has(name) && !name.includes('/') && name.endsWith('.md'));
  for (const name of removed) rmSync(join(wiki, name), { force: true });
  for (const [name, content] of files) writeFileSync(join(wiki, name), content);
  writeFileSync(manifest, [...files.keys()].sort().join('\n') + '\n');
  return { written: [...files.keys()], removed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [root, wiki, repoUrl = 'https://github.com/OlivierLB/Galeata'] = process.argv.slice(2);
  if (!root || !wiki) {
    console.error('Usage : node scripts/sync-wiki.mjs <racine-du-dépôt> <dossier-du-wiki> [url-du-dépôt]');
    process.exit(2);
  }
  const { written, removed } = syncWiki(root, wiki, repoUrl);
  console.log(`Wiki : ${written.length} page(s) écrite(s), ${removed.length} supprimée(s)${removed.length ? ` (${removed.join(', ')})` : ''}.`);
}

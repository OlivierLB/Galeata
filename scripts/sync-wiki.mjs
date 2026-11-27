#!/usr/bin/env node
// Mirrors the bilingual repository documentation into a checked-out GitHub wiki.
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
  const pageName = (name) => {
    const localized = /^(fr|en)\/(.+)\.md$/.exec(name);
    return localized ? `${localized[1].toUpperCase()}-${localized[2] === 'README' ? 'Home' : localized[2].replaceAll('/', '-')}` : name.replace(/\.md$/, '');
  };
  const pages = new Map(Object.keys(docs).sort().map((name) => [`docs/${name}`, pageName(name)]));
  const pageNames = ['Home', '_Sidebar', ...pages.values()].map((name) => name.toLowerCase());
  if (new Set(pageNames).size !== pageNames.length) throw new Error('Wiki page name collision');
  const note = (source) => source.startsWith('docs/en/')
    ? `\n\n---\n> Generated from [\`${source}\`](${repoUrl}/blob/main/${source}). Edit the French source in the repository; do not edit the wiki.\n`
    : `\n\n---\n> Page générée depuis [\`${source}\`](${repoUrl}/blob/main/${source}) : modifiez la source française dans le dépôt, pas le wiki.\n`;
  const files = new Map([['Home.md', rewriteLinks(readme, 'README.md', pages, repoUrl).trimEnd() + note('README.md')]]);
  const entries = [];
  for (const [source, page] of pages) {
    const content = docs[source.slice('docs/'.length)];
    files.set(`${page}.md`, rewriteLinks(content, source, pages, repoUrl).trimEnd() + note(source));
    if (!source.startsWith('docs/fr/') && !source.startsWith('docs/en/') && [...pages.keys()].some((key) => key.startsWith('docs/fr/'))) continue;
    entries.push([title(content, page), page, source.startsWith('docs/en/') ? 'en' : 'fr']);
  }
  entries.sort(([a], [b]) => a.localeCompare(b, 'fr'));
  const bilingual = [...pages.keys()].some((key) => key.startsWith('docs/fr/'));
  files.set('_Sidebar.md', bilingual
    ? ['**[Galeata](Home)**', '', '**[Français](FR-Home)**', '',
      ...entries.filter(([, , lang]) => lang === 'fr').map(([text, page]) => `- [${text}](${page})`), '',
      '**[English](EN-Home)**', '',
      ...entries.filter(([, , lang]) => lang === 'en').sort(([a], [b]) => a.localeCompare(b, 'en')).map(([text, page]) => `- [${text}](${page})`), ''].join('\n')
    : ['**[Accueil](Home)**', '', ...entries.map(([text, page]) => `- [${text}](${page})`), ''].join('\n'));
  return files;
}

/** Writes the generated pages and removes managed pages that no longer exist. */
export function syncWiki(root, wiki, repoUrl) {
  const collect = (directory, prefix = '') => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory() && (name === 'fr' || name === 'en')) return collect(join(directory, entry.name), `${name}/`);
    return entry.isFile() && name.endsWith('.md') ? [[name, readFileSync(join(directory, entry.name), 'utf8')]] : [];
  });
  const docs = Object.fromEntries(collect(join(root, 'docs')));
  const files = buildWikiPages({ readme: readFileSync(join(root, 'README.md'), 'utf8'), docs, repoUrl });
  const manifest = join(wiki, MANIFEST);
  const previous = existsSync(manifest) ? readFileSync(manifest, 'utf8').split('\n').filter(Boolean) : [];
  // Refuse before writing anything if a new generated name is already manual.
  for (const name of files.keys()) {
    if (existsSync(join(wiki, name)) && !previous.includes(name)) throw new Error(`Wiki page is not managed: ${name}`);
  }
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

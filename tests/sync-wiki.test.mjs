import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWikiPages, rewriteLinks, syncWiki } from '../scripts/sync-wiki.mjs';

const repo = 'https://github.com/o/r';
const pages = new Map([['docs/mcp.md', 'mcp'], ['docs/git.md', 'git']]);

test('rewrites doc, README, source and image links for the wiki', () => {
  assert.equal(rewriteLinks('[a](docs/mcp.md#tools)', 'README.md', pages, repo), '[a](mcp#tools)');
  assert.equal(rewriteLinks('[a](git.md) [b](../README.md)', 'docs/mcp.md', pages, repo), '[a](git) [b](Home)');
  assert.equal(rewriteLinks('[l](LICENSE)', 'README.md', pages, repo), `[l](${repo}/blob/main/LICENSE)`);
  assert.equal(rewriteLinks('[s](../src/App.tsx)', 'docs/mcp.md', pages, repo), `[s](${repo}/blob/main/src/App.tsx)`);
  assert.equal(rewriteLinks('![i](img/a.png)', 'docs/mcp.md', pages, repo), `![i](${repo}/raw/main/docs/img/a.png)`);
});

test('keeps external links, anchors and fenced code untouched', () => {
  const text = '[w](https://x.dev/a.md) [h](#top)\n```\n[c](docs/mcp.md)\n```\n';
  assert.equal(rewriteLinks(text, 'README.md', pages, repo), text);
});

test('builds Home, one page per doc and a sidebar sorted by title', () => {
  const files = buildWikiPages({ readme: '# Galeata\n', docs: { 'mcp.md': '# MCP interne\n', 'git.md': '# Gérer Git\n' }, repoUrl: repo });
  assert.deepEqual([...files.keys()].sort(), ['Home.md', '_Sidebar.md', 'git.md', 'mcp.md']);
  assert.match(files.get('mcp.md'), /Page générée depuis \[`docs\/mcp\.md`\]/);
  assert.equal(files.get('_Sidebar.md'), '**[Accueil](Home)**\n\n- [Gérer Git](git)\n- [MCP interne](mcp)\n');
});

test('builds languages, language switches and legacy forwards', () => {
  const docs = {
    'fr/README.md': '# Accueil\n[Git](git.md)\n',
    'en/README.md': '# Home\n[Git](git.md)\n',
    'fr/git.md': '# Gérer Git\n[English](../en/git.md)\n',
    'en/git.md': '# Manage Git\n[Français](../fr/git.md)\n',
    'git.md': '# Déplacé\n[Français](fr/git.md)\n',
  };
  const files = buildWikiPages({ readme: '# Galeata\n[English](docs/en/README.md)\n', docs, repoUrl: repo });
  assert.match(files.get('Home.md'), /\[English\]\(EN-Home\)/);
  assert.match(files.get('FR-Home.md'), /\[Git\]\(FR-git\)/);
  assert.match(files.get('FR-git.md'), /\[English\]\(EN-git\)/);
  assert.match(files.get('EN-git.md'), /\[Français\]\(FR-git\)/);
  assert.match(files.get('git.md'), /\[Français\]\(FR-git\)/);
  assert.match(files.get('_Sidebar.md'), /\*\*\[English\]\(EN-Home\)\*\*/);
  assert.match(files.get('EN-git.md'), /Edit the French source/);
});

test('rejects generated name collisions before publication', () => {
  assert.throws(() => buildWikiPages({ readme: '# Root', docs: { 'fr/README.md': '# Home', 'FR-Home.md': '# Collision' }, repoUrl: repo }), /collision/);
});

test('does not overwrite a manual page with a new localized page', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-src-'));
  const wiki = mkdtempSync(join(tmpdir(), 'wiki-dst-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(wiki, { recursive: true, force: true }); });
  mkdirSync(join(root, 'docs/fr'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# Root\n');
  writeFileSync(join(root, 'docs/fr/git.md'), '# Git\n');
  writeFileSync(join(wiki, 'FR-git.md'), 'Manual page');
  assert.throws(() => syncWiki(root, wiki, repo), /not managed/);
  assert.equal(readFileSync(join(wiki, 'FR-git.md'), 'utf8'), 'Manual page');
  assert.equal(existsSync(join(wiki, 'Home.md')), false);
});

test('removes only previously generated pages, never hand-written ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-src-'));
  const wiki = mkdtempSync(join(tmpdir(), 'wiki-dst-'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'README.md'), '# R\n');
  writeFileSync(join(root, 'docs', 'mcp.md'), '# M\n');
  writeFileSync(join(wiki, 'old.md'), 'generated before');
  writeFileSync(join(wiki, 'Manual.md'), 'by hand');
  writeFileSync(join(wiki, '.galeata-sync'), 'Home.md\nold.md\n');
  const result = syncWiki(root, wiki, repo);
  assert.deepEqual(result.removed, ['old.md']);
  assert.equal(existsSync(join(wiki, 'old.md')), false);
  assert.equal(readFileSync(join(wiki, 'Manual.md'), 'utf8'), 'by hand');
  assert.equal(readFileSync(join(wiki, '.galeata-sync'), 'utf8'), 'Home.md\n_Sidebar.md\nmcp.md\n');
});

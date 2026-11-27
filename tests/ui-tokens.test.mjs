import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/', import.meta.url);
function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? cssFiles(join(directory, entry.name)) : entry.name.endsWith('.css') ? [join(directory, entry.name)] : []);
}
test('authored UI typography, spacing and shapes use the shared design tokens', () => {
  for (const file of cssFiles(root.pathname).filter(file => !file.endsWith('/ui-tokens.css'))) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, property, value] of css.matchAll(/(?:^|[;{])\s*((?:font(?:-size|-family|-weight)?|line-height|border-radius|(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|bottom|left|right|inline|block))?)):\s*([^;}]+)/g)) {
      assert.ok(!/(?<![\w.-])\d+(?:\.\d+)?px\b/.test(value), `${file}: ${property}: ${value}`);
      if (['font-family', 'font-weight', 'line-height'].includes(property))
        assert.match(value.trim(), /^(?:var\(|inherit|normal)/, `${file}: ${property}: ${value}`);
    }
  }
});
test('all shared scale references have one definition and no alias cycles', () => {
  const tokens = readFileSync(new URL('../src/ui-tokens.css', import.meta.url), 'utf8');
  const definitions = new Map();
  for (const [, name, value] of tokens.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    assert.ok(!definitions.has(name), `Duplicate token ${name}`); definitions.set(name, value);
  }
  const resolve = (name, seen = new Set()) => {
    assert.ok(definitions.has(name), `Undefined token ${name}`);
    assert.ok(!seen.has(name), `Circular token ${name}`); seen.add(name);
    for (const [, next] of definitions.get(name).matchAll(/var\((--[\w-]+)/g)) resolve(next, new Set(seen));
  };
  for (const name of definitions.keys()) resolve(name);
  for (const file of cssFiles(root.pathname)) for (const [, name] of readFileSync(file, 'utf8').matchAll(/var\((--(?:font-|line-height-|space-|radius-|control-height|size-|stroke-|editor-line-height)[\w-]*)/g)) resolve(name);
});

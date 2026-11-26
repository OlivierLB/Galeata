import source from './ui-tokens.css?raw';

// Canvas-based widgets need resolved values rather than CSS var() expressions.
// Read the CSS source as the startup fallback, before Vite has attached styles.
const rootDefaults = source.slice(0, source.indexOf('}'));
const defaults = new Map([...rootDefaults.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
function defaultValue(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Circular UI token: ${name}`);
  seen.add(name);
  const value = defaults.get(name);
  if (!value) throw new Error(`Unknown UI token: ${name}`);
  return value.replace(/var\((--[\w-]+)\)/g, (_, reference: string) => defaultValue(reference, new Set(seen)));
}
export function readUiToken(name: `--${string}`, element?: Element): string {
  const target = element ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  const value = target && typeof getComputedStyle === 'function' ? getComputedStyle(target).getPropertyValue(name).trim() : '';
  return value && !value.includes('var(') ? value : defaultValue(name);
}
export function readUiNumber(name: `--${string}`, element?: Element): number {
  const value = Number.parseFloat(readUiToken(name, element));
  return Number.isFinite(value) ? value : Number.parseFloat(defaultValue(name));
}

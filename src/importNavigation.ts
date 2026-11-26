export interface ImportReference { specifier: string; start: number; end: number; bindingOffset?: number }
export function importReferences(source: string): ImportReference[] {
  const mask = source.split('');
  const literals = new Map<number, { start: number; end: number; value: string }>();
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('//', index) || source.startsWith('/*', index)) {
      const block = source[index + 1] === '*';
      const end = block ? source.indexOf('*/', index + 2) : source.indexOf('\n', index + 2);
      const stop = end < 0 ? source.length : end + (block ? 2 : 0);
      while (index < stop) { if (mask[index] !== '\n') mask[index] = ' '; index++; }
    } else if (['"', "'", '`'].includes(source[index])) {
      const begin = index, quote = source[index++];
      while (index < source.length) { if (source[index] === '\\') index += 2; else if (source[index++] === quote) break; }
      const end = Math.min(index, source.length);
      for (let at = begin; at < end; at++) if (mask[at] !== '\n') mask[at] = ' ';
      if (quote !== '`' && source[end - 1] === quote) {
        mask[begin] = quote; mask[end - 1] = quote;
        literals.set(begin, { start: begin + 1, end: end - 1, value: source.slice(begin + 1, end - 1) });
      }
    } else index++;
  }
  const code = mask.join('');
  const result: ImportReference[] = [];
  const pattern = /\bimport\s+([^;]*?)\bfrom\s*(["'])/g;
  for (const match of code.matchAll(pattern)) {
    const literal = literals.get(match.index! + match[0].length - 1);
    if (!literal || literal.value.includes('\\')) continue;
    const clauseStart = match.index! + match[0].indexOf(match[1]);
    const clause = match[1].replace(/^type\s+/, value => ' '.repeat(value.length));
    let bindingOffset: number | undefined;
    const defaultName = /^\s*([\p{ID_Start}_$][\p{ID_Continue}$]*)/u.exec(clause);
    if (defaultName) bindingOffset = clauseStart + defaultName.index + defaultName[0].lastIndexOf(defaultName[1]);
    else {
      const brace = clause.indexOf('{');
      if (brace >= 0) {
        const first = clause.slice(brace + 1).split(',')[0];
        const named = /(?:\btype\s+)?([\p{ID_Start}_$][\p{ID_Continue}$]*)(?:\s+as\s+([\p{ID_Start}_$][\p{ID_Continue}$]*))?/u.exec(first);
        if (named) bindingOffset = clauseStart + brace + 1 + named.index + named[0].lastIndexOf(named[2] ?? named[1]);
      }
    }
    result.push({ specifier: literal.value, start: literal.start, end: literal.end, bindingOffset });
  }
  for (const match of code.matchAll(/\b(?:import\s*|(?:import|require)\s*\(\s*)(["'])/g)) {
    const literal = literals.get(match.index! + match[0].length - 1);
    if (literal && !literal.value.includes('\\') && !result.some(item => item.start === literal.start)) result.push({ specifier: literal.value, start: literal.start, end: literal.end });
  }
  return result;
}
export function relativeImportCandidates(sourcePath: string, specifier: string): string[] {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return [];
  const parts = sourcePath.split('/').slice(0, -1);
  for (const part of specifier.split(/[?#]/, 1)[0].split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return []; parts.pop(); } else parts.push(part);
  }
  const path = parts.join('/');
  if (!path) return [];
  const stem = path.replace(/\.(?:m?js|cjs|jsx)$/, '');
  return [...new Set([path, ...(stem !== path ? [stem + '.ts', stem + '.tsx', stem + '.mts', stem + '.cts'] : []), ...['.ts','.tsx','.js','.jsx','.mts','.mjs','.cts','.cjs','.d.ts','/index.ts','/index.tsx','/index.js'].map(extension => path + extension)])];
}

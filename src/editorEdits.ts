export interface TextPosition { line: number; character: number }
export interface TextEdit { range: { start: TextPosition; end: TextPosition }; newText: string }
export interface ProposedFileEdit { path: string; before: string; after: string; stamp: string }

export function applyTextEdits(content: string, edits: TextEdit[]): string {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1);
  function offset(position: TextPosition) {
    const start = starts[position.line];
    if (!Number.isInteger(position.line) || !Number.isInteger(position.character) || start === undefined || position.character < 0)
      throw new Error('Position de modification invalide');
    const end = (starts[position.line + 1] ?? content.length + 1) - 1;
    const lineEnd = content[end - 1] === '\r' ? end - 1 : end;
    if (start + position.character > lineEnd) throw new Error('Modification hors du fichier');
    return start + position.character;
  }
  const ordered = edits.map(edit => ({ start: offset(edit.range.start), end: offset(edit.range.end), text: edit.newText }))
    .sort((a, b) => b.start - a.start || b.end - a.end);
  let boundary = content.length + 1;
  let result = content;
  for (const edit of ordered) {
    if (edit.end < edit.start || edit.end > boundary) throw new Error('Modifications concurrentes ou superposées');
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    boundary = edit.start;
  }
  return result;
}

export function projectPath(uri: string, root: string): string {
  const url = new URL(uri);
  const path = decodeURIComponent(url.pathname);
  const prefix = root.replace(/\/$/, '') + '/';
  if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || !path.startsWith(prefix))
    throw new Error('La modification sort du projet');
  const relative = path.slice(prefix.length);
  if (!relative || relative.split('/').some(part => part === '..' || part === '.')) throw new Error('Chemin de modification invalide');
  return relative;
}

export function globMatches(path: string, pattern: string): boolean {
  if (pattern.length > 512) return false;
  let remaining = 256;
  // EditorConfig-style path globs, also used by the search include/exclude fields.
  const expand = (value: string): string[] => {
    if (--remaining < 0) return [];
    const match = /\{([^{}]+)\}/.exec(value);
    if (!match) return [value];
    const numeric = /^(-?\d+)\.\.(-?\d+)$/.exec(match[1]);
    const options = numeric ? Array.from({ length: Math.min(1000, Math.abs(+numeric[2] - +numeric[1]) + 1) }, (_, index) => String(+numeric[1] + index * (+numeric[2] >= +numeric[1] ? 1 : -1))) : match[1].split(',');
    return options.flatMap(option => expand(value.slice(0, match.index) + option + value.slice(match.index + match[0].length)));
  };
  return expand(pattern).some(value => {
    let expression = '';
    for (let i = 0; i < value.length; i++) {
      const character = value[i];
      if (character === '*' && value[i + 1] === '*') {
        i++;
        if (value[i + 1] === '/') { i++; expression += '(?:.*/)?'; } else expression += '.*';
      } else if (character === '*') expression += '[^/]*';
      else if (character === '?') expression += '[^/]';
      else if (character === '[') {
        const end = value.indexOf(']', i + 1);
        if (end < 0) expression += '\\[';
        else { expression += '[' + value.slice(i + 1, end).replace(/^!/, '^') + ']'; i = end; }
      } else expression += character.replace(/[\\^$+?.()|{}\]]/g, '\\$&');
    }
    try { return new RegExp('^' + expression + '$').test(value.includes('/') ? path.replace(/^\//, '') : path.split('/').pop() ?? ''); }
    catch { return false; }
  });
}

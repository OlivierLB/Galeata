import { globMatches } from './editorEdits.ts';
export type EditorConfig = Record<string, string>;
export function parseEditorConfig(text: string, relativePath: string): { root: boolean; values: EditorConfig } {
  const values: EditorConfig = {};
  let root = false;
  let applies = true;
  let section = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;]/.test(line)) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = true;
      applies = globMatches(relativePath, line.slice(1, -1).replace(/^\//, ''));
      continue;
    }
    const match = /^([^=:]+)[=:](.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim().toLowerCase(), value = match[2].trim().toLowerCase();
    if (!section && key === 'root') root = value === 'true';
    else if (section && applies) values[key] = value;
  }
  return { root, values };
}
export async function loadEditorConfig(path: string, read: (path: string) => Promise<string>): Promise<EditorConfig> {
  const parts = path.split('/');
  const chain: EditorConfig[] = [];
  for (let depth = parts.length - 1; depth >= 0; depth--) {
    const prefix = parts.slice(0, depth).join('/');
    try {
      const config = parseEditorConfig(await read((prefix ? prefix + '/' : '') + '.editorconfig'), parts.slice(depth).join('/'));
      chain.unshift(config.values);
      if (config.root) break;
    } catch { /* An absent configuration inherits the parent directory. */ }
  }
  const values = Object.assign({}, ...chain) as EditorConfig;
  for (const key of Object.keys(values)) if (values[key] === 'unset') delete values[key];
  return values;
}
export function normalizeSavedText(text: string, config: EditorConfig): string {
  let result = text;
  if (config.trim_trailing_whitespace === 'true') result = result.replace(/[\t ]+(?=\r?$)/gm, '');
  if (config.end_of_line === 'lf') result = result.replace(/\r\n/g, '\n');
  if (config.end_of_line === 'crlf') result = result.replace(/\r?\n/g, '\r\n');
  if (config.insert_final_newline === 'true' && result && !result.endsWith('\n')) result += config.end_of_line === 'crlf' ? '\r\n' : '\n';
  return result;
}

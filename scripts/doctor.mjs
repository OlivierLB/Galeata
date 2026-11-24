import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

let missing = false;
for (const [label, command, args, required] of [
  ['Node.js', 'node', ['--version'], true], ['Rust', 'rustc', ['--version'], true],
  ['Cargo', 'cargo', ['--version'], true], ['Git', 'git', ['--version'], true],
  ['ripgrep', 'rg', ['--version'], true],
  ['WebKitGTK 4.1', 'pkg-config', ['--modversion', 'webkit2gtk-4.1'], true],
  ['GTK 3', 'pkg-config', ['--modversion', 'gtk+-3.0'], true],
  ['Codex', 'codex', ['--version'], false], ['Claude Code', 'claude', ['--version'], false],
]) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000 });
  const ok = result.status === 0;
  console.log(`${ok ? 'OK' : required ? 'MANQUANT' : 'OPTIONNEL'}  ${label}${ok ? ` : ${result.stdout.trim().split('\n')[0]}` : ''}`);
  if (required && !ok) missing = true;
}
if (!existsSync(new URL('../node_modules/monaco-editor/package.json', import.meta.url))) { console.log('MANQUANT  Dépendances npm : exécuter npm install'); missing = true; }
process.exitCode = missing ? 1 : 0;

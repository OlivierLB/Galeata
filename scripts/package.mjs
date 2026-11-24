import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync } from 'node:fs';

function run(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('npm', ['run', 'build']);
run('cargo', [
  'build',
  '--release',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  '--features',
  'custom-protocol',
  '--bin',
  'galeata-mcp',
]);
copyFileSync('src-tauri/target/release/galeata-mcp', 'src-tauri/resources/galeata-mcp');
chmodSync('src-tauri/resources/galeata-mcp', 0o755);
run('npm', ['exec', '--', 'tauri', 'build', ...process.argv.slice(2)]);

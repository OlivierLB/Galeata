import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'galeata-package-'));
try {
  const bundles = 'src-tauri/target/release/bundle/deb';
  const name = readdirSync(bundles).find((file) => file.endsWith('.deb'));
  assert(name, 'Paquet .deb absent');
  const extract = spawnSync('dpkg-deb', ['--extract', join(bundles, name), directory]);
  assert.equal(extract.status, 0, 'Extraction du paquet impossible');
  accessSync(join(directory, 'usr/bin/galeata'), constants.X_OK);
  function findBridge(path, depth = 6) {
    if (depth === 0) return null;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isFile() && entry.name === 'galeata-mcp') return file;
      if (entry.isDirectory()) {
        const found = findBridge(file, depth - 1);
        if (found) return found;
      }
    }
    return null;
  }
  const bridge = findBridge(join(directory, 'usr/lib'));
  assert(bridge, 'Passerelle MCP absente du paquet');
  accessSync(bridge, constants.X_OK);
  const input =
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'package-check', version: '1' },
      },
    }) + '\n';
  const result = spawnSync(
    bridge,
    ['--socket', join(directory, 'absent.sock'), '--workspace', 'package-check'],
    { input, encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).error.code,
    -32001,
    'Le transport doit signaler que l’IDE est fermé',
  );
  console.log(
    `Paquet vérifié : exécutable, ressource MCP et réponse stdio hors connexion (${name}).`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}

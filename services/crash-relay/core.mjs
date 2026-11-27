import { createHash } from 'node:crypto';

export const MAX_BODY = 32 * 1024;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const token = (value, pattern, limit) => typeof value === 'string' && value.length <= limit && pattern.test(value);
const symbol = value => token(value, /^(galeata_lib|galeata_agent_protocol)::[a-zA-Z0-9_:<> ,{}$.-]+$/, 240);
const operations = new Set(['startup', 'exit', 'panic', 'request.unknown',
  'activity.list', 'activity.report', 'agent.answer', 'agent.close', 'agent.compact', 'agent.interrupt', 'agent.list', 'agent.mode', 'agent.model', 'agent.models', 'agent.respond', 'agent.send', 'agent.skills', 'agent.start',
  'git.branches', 'git.diff', 'git.editor_diff', 'git.get_diff', 'git.get_status', 'git.mutate', 'git.overview', 'git.status', 'git.worktrees',
  'mcp.config', 'plan.get', 'plan.propose_change', 'plan.save', 'plan.set', 'plan.update_step', 'preferences.get', 'preferences.save', 'providers.list',
  'remote.connect', 'remote.connection', 'remote.detail', 'remote.disconnect', 'remote.list', 'session.save_handoff', 'sessions.list',
  'terminal.close', 'terminal.input', 'terminal.resize', 'terminal.start', 'ui.open_file', 'ui.show_diff', 'verification.record', 'verification.run',
  'workspace.context', 'workspace.create', 'workspace.delete', 'workspace.get_context', 'workspace.list', 'workspace.read', 'workspace.rename', 'workspace.search_files', 'workspace.search_text', 'workspace.write']);
const codes = new Set(['NONE', 'INCOMPLETE', 'CONFLICT', 'WORKSPACE_REQUIRED', 'ACCESS_DENIED', 'INVALID_ARGUMENT', 'UNCLASSIFIED', 'UNKNOWN_OR_UNAUTHORIZED']);

/** Construct a fresh allowlisted object; unknown fields never reach GitHub. */
export function normalizeReport(data) {
  if (!data || data.platform !== 'linux' || !['abnormal_exit', 'rust_panic'].includes(data.reason) || !token(data.version, /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, 64)) return null;
  const base = { version: data.version, platform: 'linux', reason: data.reason };
  if (data.schema === undefined && data.reason === 'abnormal_exit') return base;
  if (data.schema !== 2 || !token(data.reportId, /^[0-9a-f-]{36}$/, 36) || !token(data.build, /^(?:[a-f0-9]{7,40}|unknown)$/, 40)
    || !['x86_64', 'aarch64', 'x86', 'arm', 'riscv64'].includes(data.arch) || !token(data.kernel, /^[0-9.]*$/, 32)
    || !['wayland', 'x11', 'unknown'].includes(data.display) || !integer(data.startedAtMs) || data.startedAtMs > 8_640_000_000_000_000 || !integer(data.observedAtMs) || data.observedAtMs > 8_640_000_000_000_000
    || !integer(data.uptimeSeconds) || !(data.memoryKib === null || integer(data.memoryKib)) || !Array.isArray(data.events) || data.events.length > 32) return null;
  const events = [];
  for (const event of data.events) {
    if (!event || !integer(event.atMs) || !integer(event.elapsedMs) || typeof event.ok !== 'boolean' || !operations.has(event.operation) || !codes.has(event.code)) return null;
    events.push({ atMs: event.atMs, operation: event.operation, elapsedMs: event.elapsedMs, ok: event.ok, code: event.code });
  }
  let panic = null;
  if (data.panic !== null) {
    const p = data.panic;
    if (!p || !['assertion', 'unwrap', 'bounds', 'overflow', 'other'].includes(p.kind) || !(p.source === null || (token(p.source, /^(src|crates)\/[a-zA-Z0-9_./-]+\.rs$/, 160) && !p.source.includes('..')))
      || !(p.line === null || integer(p.line)) || !(p.column === null || integer(p.column)) || !Array.isArray(p.frames) || p.frames.length > 32 || !p.frames.every(symbol)) return null;
    panic = { kind: p.kind, source: p.source, line: p.line, column: p.column, frames: p.frames };
  }
  if ((data.reason === 'rust_panic') !== (panic !== null)) return null;
  return { ...base, schema: 2, reportId: data.reportId, build: data.build, arch: data.arch, kernel: data.kernel, display: data.display,
    startedAtMs: data.startedAtMs, observedAtMs: data.observedAtMs, uptimeSeconds: data.uptimeSeconds, memoryKib: data.memoryKib, panic, events };
}
export function reportSignature(data) {
  return createHash('sha256').update(JSON.stringify([data.version, data.build, data.reason, data.arch, data.panic?.kind, data.panic?.source, data.panic?.line, data.panic?.frames])).digest('hex').slice(0, 16);
}
export function issueBody(data, signature) {
  const lines = [`Rapport automatique · signature ${signature}`, '', `Version : ${data.version}`, `Motif : ${data.reason}`];
  if (data.schema === 2) {
    lines.push(`Build : ${data.build}`, `Linux ${data.kernel} · ${data.arch} · ${data.display}`, `Durée : ${data.uptimeSeconds} s · mémoire RSS : ${data.memoryKib ?? 'inconnue'} Kio`,
      `Dernier instantané : ${data.observedAtMs ? new Date(data.observedAtMs).toISOString() : 'non disponible (ancien rapport)'}`, `Rapport : ${data.reportId}`);
    if (data.panic) lines.push('', `Catégorie : ${data.panic.kind}`, `Origine : ${data.panic.source ?? 'non disponible'}:${data.panic.line ?? '?'}:${data.panic.column ?? '?'}`, '', 'Pile Galeata (sans chemins absolus) :', '```text', ...data.panic.frames, '```');
    lines.push('', 'Derniers événements techniques :', '```text', ...data.events.map(event => `${event.atMs} ${event.operation} ${event.elapsedMs}ms ok=${event.ok} ${event.code}`), '```');
  }
  lines.push('', 'Aucun code utilisateur, argument de commande, conversation ou message brut de panique transmis.', 'Une fermeture forcée ou un arrêt système peut également produire une fermeture anormale.');
  return lines.join('\n');
}


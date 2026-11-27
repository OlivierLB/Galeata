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
const reasons = ['abnormal_exit', 'rust_panic', 'fatal_signal', 'webview_crash'];
const signals = new Set(['SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGILL', 'SIGFPE', 'SIGQUIT']);
const webviewReasons = new Set(['crashed', 'memory_limit']);
const nativeHints = new Set(['x_io_error', 'x_protocol_error', 'wayland_disconnected', 'gtk_assertion', 'missing_library']);
const codes = new Set(['NONE', 'INCOMPLETE', 'CONFLICT', 'WORKSPACE_REQUIRED', 'ACCESS_DENIED', 'INVALID_ARGUMENT', 'UNCLASSIFIED', 'UNKNOWN_OR_UNAUTHORIZED']);

/** Construct a fresh allowlisted object; unknown fields never reach GitHub. */
export function normalizeReport(data) {
  if (!data || data.platform !== 'linux' || !reasons.includes(data.reason) || !token(data.version, /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, 64)) return null;
  const base = { version: data.version, platform: 'linux', reason: data.reason };
  if (data.schema === undefined && data.reason === 'abnormal_exit') return base;
  if (![2, 3].includes(data.schema) || (data.schema === 2 && !['abnormal_exit', 'rust_panic'].includes(data.reason)) || !token(data.reportId, /^[0-9a-f-]{36}$/, 36) || !token(data.build, /^(?:[a-f0-9]{7,40}|unknown)$/, 40)
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
  const absent = value => value === undefined || value === null;
  const signal = absent(data.signal) ? null : data.signal;
  const webview = absent(data.webview) ? null : data.webview;
  if ((signal !== null && !signals.has(signal)) || (data.reason === 'fatal_signal') !== (signal !== null)) return null;
  if ((webview !== null && !webviewReasons.has(webview)) || (data.reason === 'webview_crash') !== (webview !== null)) return null;
  let native = null;
  if (!absent(data.native)) {
    const n = data.native;
    const optional = (value, pattern, limit) => value === null || token(value, pattern, limit);
    if (!n || !optional(n.domain, /^[A-Za-z][\w-]*$/, 40) || !optional(n.level, /^(ERROR|CRITICAL|WARNING)$/, 8)
      || !(n.source === null || (token(n.source, /^\w[\w./-]*\.(c|cpp|cc|h)$/, 120) && !n.source.includes('..')))
      || !(n.line === null || integer(n.line)) || !optional(n.function, /^\w+$/, 80)
      || !Array.isArray(n.libraries) || n.libraries.length > 8 || !n.libraries.every(lib => token(lib, /^lib[\w+-]+\.so(\.\d+)*$/, 80))
      || !Array.isArray(n.hints) || n.hints.length > 5 || !n.hints.every(hint => nativeHints.has(hint))) return null;
    native = { domain: n.domain, level: n.level, source: n.source, line: n.line, function: n.function, libraries: n.libraries, hints: n.hints };
  }
  const extra = data.schema === 3 ? { signal, webview, native } : {};
  return { ...base, schema: data.schema, ...extra, reportId: data.reportId, build: data.build, arch: data.arch, kernel: data.kernel, display: data.display,
    startedAtMs: data.startedAtMs, observedAtMs: data.observedAtMs, uptimeSeconds: data.uptimeSeconds, memoryKib: data.memoryKib, panic, events };
}
export function reportSignature(data) {
  const parts = [data.version, data.build, data.reason, data.arch, data.panic?.kind, data.panic?.source, data.panic?.line, data.panic?.frames];
  // Schema 2 signatures stay identical so existing issues keep grouping.
  if (data.schema === 3) parts.push(data.signal, data.webview, data.native?.domain, data.native?.source, data.native?.line, data.native?.function);
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}
export function issueTitle(data, signature) {
  const kind = { rust_panic: 'Panique Rust', fatal_signal: `Signal fatal ${data.signal}`, webview_crash: 'Plantage de l’affichage WebKit' }[data.reason] ?? 'Fermeture anormale';
  return `${kind} — Galeata ${data.version} [${signature}]`;
}
export function issueBody(data, signature) {
  const lines = [`Rapport automatique · signature ${signature}`, '', `Version : ${data.version}`, `Motif : ${data.reason}`];
  if (data.schema >= 2) {
    lines.push(`Build : ${data.build}`, `Linux ${data.kernel} · ${data.arch} · ${data.display}`, `Durée : ${data.uptimeSeconds} s · mémoire RSS : ${data.memoryKib ?? 'inconnue'} Kio`,
      `Dernier instantané : ${data.observedAtMs ? new Date(data.observedAtMs).toISOString() : 'non disponible (ancien rapport)'}`, `Rapport : ${data.reportId}`);
    if (data.signal) lines.push('', `Signal : ${data.signal}`);
    if (data.webview) lines.push('', `Processus d’affichage WebKit : ${data.webview === 'memory_limit' ? 'limite mémoire dépassée' : 'plantage'} (la fenêtre principale a survécu)`);
    if (data.native) lines.push('', 'Erreur native (journal système, sans message brut) :', '```text',
      `${data.native.domain ?? '?'} ${data.native.level ?? '?'} ${data.native.source ?? '?'}:${data.native.line ?? '?'} ${data.native.function ?? ''}`.trim(),
      ...(data.native.libraries.length ? [`Bibliothèques citées : ${data.native.libraries.join(', ')}`] : []),
      ...(data.native.hints.length ? [`Indices : ${data.native.hints.join(', ')}`] : []), '```');
    if (data.panic) lines.push('', `Catégorie : ${data.panic.kind}`, `Origine : ${data.panic.source ?? 'non disponible'}:${data.panic.line ?? '?'}:${data.panic.column ?? '?'}`, '', 'Pile Galeata (sans chemins absolus) :', '```text', ...data.panic.frames, '```');
    lines.push('', 'Derniers événements techniques :', '```text', ...data.events.map(event => `${event.atMs} ${event.operation} ${event.elapsedMs}ms ok=${event.ok} ${event.code}`), '```');
  }
  lines.push('', 'Aucun code utilisateur, argument de commande, conversation ou message brut de panique transmis.', 'Une fermeture forcée ou un arrêt système peut également produire une fermeture anormale.');
  return lines.join('\n');
}


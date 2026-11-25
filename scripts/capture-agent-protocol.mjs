#!/usr/bin/env node
// Captures the structured protocol of the installed Claude Code and Codex CLIs
// into JSONL fixtures used by Galeata's parser tests.
//
// Usage: node scripts/capture-agent-protocol.mjs [--provider claude|codex|all] [--force]
//        [--claude-bin PATH] [--codex-bin PATH] [--out DIR] [--timeout SECONDS]
//
// Each provider runs the same three turns in a throwaway git repository:
//   1. a plain answer, 2. a file read, 3. a file write that should need approval
//   (approved once by this script). Existing fixtures are kept unless --force.
// Captured lines are sanitized: home/work paths, e-mails and the user's installed
// tools/plugins/MCP servers are replaced, so fixtures can be committed.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const provider = option('provider', 'all');
const force = argv.includes('--force');
const outDir = resolve(option('out', 'tests/fixtures/agents'));
const timeoutMs = Number(option('timeout', '180')) * 1000;
const bins = {
  claude: option('claude-bin', join(homedir(), '.local/bin/claude')),
  codex: option('codex-bin', 'codex'),
};
const turns = [
  'Réponds exactement : ok',
  'Lis le fichier hello.txt et cite son contenu, sans rien ajouter.',
  'Crée le fichier out.txt contenant exactement : galeata. Utilise ton outil d’édition de fichiers, pas une commande shell.',
];
// Extra Claude scenarios (--scenario): plan approval and questions to the user.
// Progress tracking: the agent's native task list (both providers).
const todoTurn =
  'Crée une liste de tâches de deux étapes avec ton outil de suivi des tâches (et pas un fichier) : 1. Lire hello.txt ; 2. Résumer son contenu. Fais ensuite les deux étapes en mettant la liste à jour au fur et à mesure.';
const codexScenarios = { basic: turns, todo: [todoTurn] };
const claudeScenarios = {
  todo: { args: ['--permission-mode', 'auto'], turns: [todoTurn] },
  basic: { args: [], turns },
  plan: {
    args: ['--permission-mode', 'plan'],
    turns: [
      'Prépare un plan en deux étapes pour créer le fichier notes.txt contenant exactement : bonjour. Présente-le pour validation, puis exécute-le une fois validé.',
    ],
  },
  auto: {
    args: ['--permission-mode', 'auto'],
    turns: [
      'Exécute exactement la commande suivante et donne son résultat : RTK_DISABLED=1 git status --short | head -5',
    ],
  },
  question: {
    args: [],
    turns: [
      'Utilise l’outil AskUserQuestion pour me demander ma couleur préférée, avec exactement les options Rouge et Bleu. Ensuite, réponds uniquement par la couleur que j’ai choisie.',
    ],
  },
};
const scenario = option('scenario', 'basic');
if (!claudeScenarios[scenario]) {
  console.error(`Scénario inconnu : ${scenario} (${Object.keys(claudeScenarios).join(', ')})`);
  process.exit(2);
}
const log = (message) => process.stderr.write(`[capture] ${message}\n`);
const children = new Set();

function makeWorkdir() {
  const dir = mkdtempSync(join(tmpdir(), 'galeata-capture-'));
  writeFileSync(join(dir, 'hello.txt'), 'Bonjour depuis Galeata\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

const REDACTED_KEYS = new Set([
  'tools',
  'mcp_servers',
  'mcpServers',
  'slash_commands',
  'skills',
  'agents',
  'plugins',
  'output_style',
  'commands',
  'models',
  'account',
  'available_output_styles',
]);
// Scalar fields describing the user's machine or private hook configuration.
const REDACTED_STRINGS = new Set([
  'statusMessage',
  'serverName',
  'installationId',
  'userAgent',
  'pid',
  'processId',
]);
function sanitize(value, workdir) {
  const home = homedir();
  const user = userInfo().username;
  const walk = (node, key) => {
    if (REDACTED_STRINGS.has(key) && node !== null && typeof node !== 'object') return '<retiré>';
    if (typeof node === 'string')
      return node
        .split(workdir)
        .join('/WORKDIR')
        .split(home)
        .join('/HOME')
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'user@example.com')
        .split(user)
        .join('USER');
    if (Array.isArray(node)) {
      if (REDACTED_KEYS.has(key)) return [`<${node.length} éléments retirés>`];
      return node.map((item) => walk(item, undefined));
    }
    if (node && typeof node === 'object') {
      if (REDACTED_KEYS.has(key)) return { redacted: true };
      // Commands reading the user's home (global instructions…) keep their shape, not their output.
      if (typeof node.command === 'string' && node.command.includes(home))
        node = { ...node, aggregatedOutput: '<sortie retirée : lecture du dossier personnel>' };
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    }
    return node;
  };
  return walk(value, undefined);
}

// Generic JSONL process wrapper: records every line in both directions.
function jsonlProcess(command, args, cwd, record) {
  const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  child.on('exit', () => children.delete(child));
  const listeners = new Set();
  const stderr = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      record('out-raw', line);
      return;
    }
    record('out', message);
    for (const listener of listeners) listener(message);
  });
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
  const exited = new Promise((done) =>
    child.on('exit', (code, signal) => done({ code, signal, stderr: stderr.join('') })),
  );
  return {
    child,
    exited,
    send(message) {
      record('in', message);
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    waitFor(predicate, label) {
      return new Promise((done, fail) => {
        const timer = setTimeout(() => {
          listeners.delete(listener);
          fail(
            new Error(
              `Délai dépassé en attendant ${label}. stderr : ${stderr.join('').slice(-2000)}`,
            ),
          );
        }, timeoutMs);
        const listener = (message) => {
          if (!predicate(message)) return;
          clearTimeout(timer);
          listeners.delete(listener);
          done(message);
        };
        listeners.add(listener);
      });
    },
    on(listener) {
      listeners.add(listener);
    },
  };
}

async function captureClaude(workdir, record) {
  const proc = jsonlProcess(
    bins.claude,
    [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-prompts',
      'host',
      // Undocumented in --help but used by the Agent SDK: route prompts over stdio.
      '--permission-prompt-tool',
      'stdio',
      '--setting-sources',
      'project',
      '--strict-mcp-config',
      '--no-session-persistence',
      ...claudeScenarios[scenario].args,
    ],
    workdir,
    record,
  );
  // Answer permission prompts once; reply with an error to unknown control requests.
  proc.on((message) => {
    if (message.type !== 'control_request') return;
    const request = message.request ?? {};
    if (request.subtype === 'can_use_tool') {
      const input = request.input ?? {};
      let response = { behavior: 'allow', updatedInput: input };
      // Questions: answers keyed by question text (Agent SDK convention), first option chosen…
      if (request.tool_name === 'AskUserQuestion')
        response = {
          behavior: 'allow',
          updatedInput: {
            ...input,
            answers: Object.fromEntries(
              (input.questions ?? []).map((q) => [q.question, q.options?.at(-1)?.label ?? '']),
            ),
          },
        };
      // Plan: approved, and file edits accepted for the rest of the session.
      if (request.tool_name === 'ExitPlanMode')
        response = {
          behavior: 'allow',
          updatedInput: input,
          updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
        };
      proc.send({
        type: 'control_response',
        response: { subtype: 'success', request_id: message.request_id, response },
      });
    } else
      proc.send({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: message.request_id,
          error: `Galeata capture: subtype non géré ${request.subtype}`,
        },
      });
  });
  // SDK handshake: declares this host as the permission handler.
  proc.send({
    type: 'control_request',
    request_id: 'galeata-init',
    request: { subtype: 'initialize', hooks: null },
  });
  await proc.waitFor(
    (message) =>
      message.type === 'control_response' && message.response?.request_id === 'galeata-init',
    'la réponse à initialize',
  );
  const claudeTurns = claudeScenarios[scenario].turns;
  for (const [index, text] of claudeTurns.entries()) {
    log(`claude tour ${index + 1}/${claudeTurns.length}`);
    proc.send({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    });
    await proc.waitFor((message) => message.type === 'result', `le résultat du tour ${index + 1}`);
  }
  proc.child.stdin.end();
  return proc.exited;
}

async function captureCodex(workdir, record) {
  const proc = jsonlProcess(bins.codex, ['app-server'], workdir, record);
  let nextId = 1;
  const call = async (method, params) => {
    const id = nextId++;
    proc.send({ jsonrpc: '2.0', id, method, params });
    const reply = await proc.waitFor((message) => message.id === id && !message.method, method);
    if (reply.error) throw new Error(`${method} : ${JSON.stringify(reply.error)}`);
    return reply.result;
  };
  // Approve each server request once; reject anything else explicitly.
  proc.on((message) => {
    if (message.id === undefined || !message.method) return;
    if (/requestApproval|ApplyPatchApproval|ExecCommandApproval/i.test(message.method))
      proc.send({ jsonrpc: '2.0', id: message.id, result: { decision: 'accept' } });
    else
      proc.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Galeata capture: ${message.method} non géré` },
      });
  });
  await call('initialize', { clientInfo: { name: 'galeata', title: 'Galeata', version: '0.1.0' } });
  proc.send({ jsonrpc: '2.0', method: 'initialized' });
  const started = await call('thread/start', {
    cwd: workdir,
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
    ephemeral: true,
  });
  const threadId = started?.thread?.id;
  if (!threadId) throw new Error(`thread/start sans identifiant : ${JSON.stringify(started)}`);
  const codexTurns = codexScenarios[scenario] ?? turns;
  for (const [index, text] of codexTurns.entries()) {
    log(`codex tour ${index + 1}/${codexTurns.length}`);
    await call('turn/start', { threadId, input: [{ type: 'text', text }] });
    await proc.waitFor(
      (message) => message.method === 'turn/completed',
      `turn/completed ${index + 1}`,
    );
  }
  proc.child.stdin.end();
  setTimeout(() => proc.child.kill('SIGTERM'), 3000).unref();
  return proc.exited;
}

async function capture(name, run) {
  const file = join(outDir, `${name}.jsonl`);
  if (existsSync(file) && !force) {
    log(`${file} existe déjà, ignoré (utiliser --force pour recapturer)`);
    return true;
  }
  const workdir = makeWorkdir();
  const started = Date.now();
  const lines = [];
  const record = (dir, msg) =>
    lines.push(JSON.stringify({ dir, t: Date.now() - started, msg: sanitize(msg, workdir) }));
  try {
    const exit = await run(workdir, record);
    log(`${name} terminé (code ${exit.code ?? exit.signal}), ${lines.length} lignes`);
    if (exit.code && exit.stderr) log(`${name} stderr : ${exit.stderr.slice(-1500)}`);
    return true;
  } catch (error) {
    log(`${name} ÉCHEC : ${error.message}`);
    return false;
  } finally {
    for (const child of children) child.kill('SIGTERM');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, `${lines.join('\n')}\n`);
    log(`écrit ${file}`);
    rmSync(workdir, { recursive: true, force: true });
  }
}

const results = [];
if (provider === 'claude' || provider === 'all')
  results.push(
    await capture(scenario === 'basic' ? 'claude' : `claude-${scenario}`, captureClaude),
  );
if (provider === 'codex' || provider === 'all')
  results.push(await capture(scenario === 'basic' ? 'codex' : `codex-${scenario}`, captureCodex));
process.exit(results.every(Boolean) ? 0 : 1);

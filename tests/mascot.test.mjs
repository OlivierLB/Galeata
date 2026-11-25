import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MascotStore } from '../src/mascot/store.ts';
import { animations } from '../src/mascot/animations.ts';
import { keyCyan } from '../src/mascot/sprites.ts';

function createStore() {
  const pending = new Set();
  const store = new MascotStore((callback) => {
    pending.add(callback);
    return () => pending.delete(callback);
  });
  return { store, expire: () => { for (const callback of [...pending]) { pending.delete(callback); callback(); } } };
}

test('live agent events drive the mascot and approvals take precedence over decorations', () => {
  const { store, expire } = createStore();
  store.onAgentEvents('a', [{ type: 'turnStarted' }]);
  assert.equal(store.get('a').animation, 'thinking');
  store.onAgentEvents('a', [{ type: 'textDelta', itemId: 'm', text: 'Hello' }]);
  assert.equal(store.get('a').animation, 'responding');
  store.onAgentEvents('a', [{ type: 'toolStarted', itemId: 'tool', tool: 'command', title: 'ls' }]);
  assert.equal(store.get('a').animation, 'working');
  store.onAgentEvents('a', [{ type: 'approval', requestId: 'q', kind: 'command', title: 'ls' }]);
  store.react('plan-completed');
  assert.equal(store.get('a').animation, 'waiting');
  expire();
  store.onAgentEvents('a', [{ type: 'approvalResolved', requestId: 'q' }]);
  assert.equal(store.get('a').animation, 'working');
  store.onAgentEvents('a', [{ type: 'toolCompleted', itemId: 'tool', ok: true }]);
  assert.equal(store.get('a').animation, 'thinking');
  store.onAgentEvents('a', [{ type: 'turnCompleted', status: 'completed' }]);
  assert.equal(store.get('a').animation, 'success');
  expire();
  assert.equal(store.get('a').animation, 'idle');
});

test('history, another conversation and token bursts do not disturb the current mood', () => {
  const { store } = createStore();
  store.onAgentEvents('history', [{ type: 'toolStarted', itemId: 'old', tool: 'command' }]);
  assert.equal(store.get('history').animation, 'idle');
  store.onAgentEvents('a', [{ type: 'turnStarted' }]);
  store.onAgentEvents('b', [{ type: 'turnStarted' }, { type: 'toolStarted', itemId: 'tool', tool: 'command' }]);
  assert.equal(store.get('a').animation, 'thinking');
  assert.equal(store.get('b').animation, 'working');
  let notifications = 0;
  store.subscribe(() => notifications++);
  for (let index = 0; index < 100; index++) store.onAgentEvents('a', [{ type: 'textDelta', itemId: 'm', text: 'x' }]);
  assert.equal(notifications, 1);
  store.clear();
  assert.equal(store.get('a').animation, 'idle');
});

test('errors, interruptions and application reactions expire without claiming verification', () => {
  const { store, expire } = createStore();
  store.onAgentEvents('a', [{ type: 'turnStarted' }, { type: 'turnCompleted', status: 'failed' }]);
  assert.equal(store.get('a').animation, 'error');
  expire();
  store.onAgentEvents('a', [{ type: 'turnStarted' }, { type: 'turnCompleted', status: 'interrupted' }]);
  assert.equal(store.get('a').animation, 'idle');
  store.react('step-completed');
  assert.equal(store.get().animation, 'step');
  expire();
  store.react('plan-completed');
  assert.equal(store.get().animation, 'goal');
  expire();
  store.react('text-edit', 'a');
  assert.equal(store.get('a').animation, 'responding');
  expire();
  assert.equal(store.get('a').animation, 'idle');
  store.react('play', 'a');
  store.remove('a');
  expire();
  assert.equal(store.get('a').animation, 'idle');
});

test('cyan removal preserves warm character colors and every source sheet is accounted for', () => {
  const pixels = new Uint8ClampedArray([0, 240, 230, 255, 220, 170, 80, 255, 35, 65, 80, 255]);
  keyCyan(pixels);
  assert.equal(pixels[3], 0);
  assert.equal(pixels[7], 255);
  assert.equal(pixels[11], 255);
  const root = new URL('../public/mascot/turtle/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.assets.length, 8);
  assert.equal(manifest.assets.reduce((sum, asset) => sum + asset.sources.length, 0), 33);
  assert.equal(new Set(Object.values(animations).map((animation) => animation.file)).size, 8);
  for (const asset of manifest.assets) {
    const bytes = readFileSync(new URL(asset.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    for (const animation of Object.values(animations).filter((animation) => animation.file === asset.file)) {
      assert.ok(animation.frames.every((frame) => frame >= 0 && frame < animation.columns));
    }
  }
});

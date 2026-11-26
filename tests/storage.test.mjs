import test from 'node:test';
import assert from 'node:assert/strict';
import { readPreference, writePreference } from '../src/storage.ts';

test('optional preferences tolerate absent, denied and full storage', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.equal(readPreference('key'), null);
    assert.doesNotThrow(() => writePreference('key', 'value'));
    const values = new Map();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    } });
    assert.equal(readPreference('missing'), null);
    writePreference('key', 'false');
    assert.equal(readPreference('key'), 'false');
    localStorage.setItem = () => { throw new Error('quota'); };
    assert.doesNotThrow(() => writePreference('key', 'new'));
    assert.equal(readPreference('key'), 'false');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

import { afterEach, expect, test } from 'vitest';
import { readUiNumber, readUiToken } from '../../src/uiTokens.ts';
afterEach(() => document.documentElement.removeAttribute('style'));
test('widget defaults resolve CSS aliases before the stylesheet is attached', () => {
  expect(readUiNumber('--editor-font-size')).toBe(13);
  expect(readUiNumber('--terminal-font-size')).toBe(12);
  expect(readUiNumber('--editor-line-height')).toBe(23);
  expect(readUiToken('--editor-font-family')).toContain('JetBrains Mono');
});
test('canvas widgets consume computed CSS overrides rather than copied constants', () => {
  document.documentElement.style.setProperty('--editor-line-height', '29px');
  document.documentElement.style.setProperty('--terminal-font-size', '17px');
  document.documentElement.style.setProperty('--font-family-terminal', 'test-mono');
  expect(readUiNumber('--editor-line-height')).toBe(29);
  expect(readUiNumber('--terminal-font-size')).toBe(17);
  expect(readUiToken('--font-family-terminal')).toBe('test-mono');
});

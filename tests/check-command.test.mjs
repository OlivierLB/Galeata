import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatCommand } from '../src/checks/command.ts';

test('displayed commands preserve literal arguments when copied into a terminal', () => {
  const values = ['a b', "a'b", '$(printf expanded)', '; printf injected', '', 'line\nbreak'];
  const command = formatCommand('printf', ['%s\n', ...values]);
  assert.equal(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' }), values.join('\n') + '\n');
  assert.equal(formatCommand('npm', ['run', 'check']), 'npm run check');
});

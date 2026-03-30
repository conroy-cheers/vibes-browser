import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCliArgs } from '../../src/config.mjs';

test('parseCliArgs uses defaults', () => {
  const config = parseCliArgs([]);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8080);
  assert.equal(config.model, 'gpt-5.4-mini');
  assert.equal(config.reasoningEffort, 'low');
  assert.equal(config.maxRepairAttempts, 2);
});

test('parseCliArgs reads overrides', () => {
  const config = parseCliArgs([
    '--port',
    '9000',
    '--model',
    'gpt-5.4',
    '--reasoning-effort',
    'medium',
    '--max-repair-attempts',
    '3',
    '--verbose',
  ]);
  assert.equal(config.port, 9000);
  assert.equal(config.model, 'gpt-5.4');
  assert.equal(config.reasoningEffort, 'medium');
  assert.equal(config.maxRepairAttempts, 3);
  assert.equal(config.logLevel, 'debug');
});

test('parseCliArgs reads explicit log level', () => {
  const config = parseCliArgs(['--log-level', 'warn']);
  assert.equal(config.logLevel, 'warn');
});

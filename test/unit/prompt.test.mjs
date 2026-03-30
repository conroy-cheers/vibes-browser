import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt } from '../../src/prompt.mjs';

test('buildSystemPrompt defaults to system-prompt.md content', () => {
  const expected = fs.readFileSync(
    new URL('../../system-prompt.md', import.meta.url),
    'utf8',
  );
  assert.equal(buildSystemPrompt(), expected);
});

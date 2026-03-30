import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDefaultRuntimeConfig,
  buildSystemPrompt,
} from '../../src/prompt.mjs';

test('buildSystemPrompt defaults to system-prompt.md content', () => {
  const expected = fs.readFileSync(
    new URL('../../system-prompt.md', import.meta.url),
    'utf8',
  );
  assert.equal(buildSystemPrompt(), expected);
});

test('buildDefaultRuntimeConfig loads all prompt markdown files', () => {
  const runtimeConfig = buildDefaultRuntimeConfig();

  assert.equal(
    runtimeConfig.sessionPlanner.prompt,
    fs.readFileSync(new URL('../../system-prompt.md', import.meta.url), 'utf8'),
  );
  assert.equal(
    runtimeConfig.renderer.pagePrompt,
    fs.readFileSync(
      new URL('../../renderer-page-prompt.md', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    runtimeConfig.renderer.scaffolding,
    fs.readFileSync(
      new URL('../../renderer-scaffolding.md', import.meta.url),
      'utf8',
    ),
  );
});

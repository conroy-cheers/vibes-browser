import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS } from '../../src/config.mjs';
import { createDeveloperConsole } from '../../src/dev-console.mjs';
import { createRuntimeState } from '../../src/runtime-state.mjs';

function makeConfig() {
  return {
    ...DEFAULTS,
    consoleHost: '127.0.0.1',
    consolePort: 0,
  };
}

test('developer console exposes runtime config APIs', async () => {
  const runtimeState = createRuntimeState({ config: makeConfig() });
  const developerConsole = createDeveloperConsole(makeConfig(), {
    runtimeState,
  });
  const address = await developerConsole.listen();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const before = await fetch(`${base}/api/runtime-config`).then((response) =>
      response.json(),
    );
    assert.equal(before.version, 1);
    assert.equal(before.active.sessionPlanner.model, DEFAULTS.model);

    const applied = await fetch(`${base}/api/runtime-config/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionPlanner: {
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
          prompt: 'updated session prompt',
        },
        renderer: {
          model: 'gpt-5',
          reasoningEffort: 'high',
          pagePrompt: 'updated page prompt',
          scaffolding: 'updated scaffolding',
        },
      }),
    }).then((response) => response.json());
    assert.equal(applied.version, 2);
    assert.equal(applied.active.sessionPlanner.model, 'gpt-5.4');
    assert.equal(applied.active.renderer.model, 'gpt-5');
    assert.equal(applied.active.renderer.scaffolding, 'updated scaffolding');

    const reset = await fetch(`${base}/api/runtime-config/reset`, {
      method: 'POST',
    }).then((response) => response.json());
    assert.equal(reset.version, 2);
    assert.equal(reset.draft.renderer.scaffolding, 'updated scaffolding');
  } finally {
    await developerConsole.close();
  }
});

test('developer console exposes session transcripts', async () => {
  const runtimeState = createRuntimeState({ config: makeConfig() });
  runtimeState.sessions.set('session-1', {
    id: 'session-1',
    mode: 'local',
    seedPhrase: 'orbital bus depot',
    createdAt: 1,
    lastSeenAt: 2,
  });
  runtimeState.recordEvent({
    type: 'browser.request.normalized',
    actor: 'browser',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    trigger: 'link_click',
    startedAt: 1000,
    endedAt: 1010,
    durationMs: 10,
    summary: 'Normalized request',
    payload: {
      method: 'GET',
      path: '/',
    },
  });
  runtimeState.recordEvent({
    type: 'session.plan.input',
    actor: 'session_agent',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    summary: 'Session planner input',
    payload: {
      seed_phrase: 'orbital bus depot',
      request: {
        method: 'GET',
        path: '/',
      },
    },
  });
  runtimeState.recordEvent({
    type: 'session.plan.output',
    actor: 'session_agent',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    startedAt: 1010,
    endedAt: 1090,
    durationMs: 80,
    payload: {
      attempt: 0,
      output: '{"kind":"page"}',
      reasoningSummary: 'Planner summary',
    },
  });
  runtimeState.recordEvent({
    type: 'session.plan.parsed',
    actor: 'session_agent',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    payload: {
      attempt: 0,
      parsed: {
        kind: 'page',
        title: 'Depot',
      },
    },
  });
  runtimeState.recordEvent({
    type: 'browser.response',
    actor: 'browser',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    status: 200,
    startedAt: 1000,
    endedAt: 1100,
    durationMs: 100,
  });

  const developerConsole = createDeveloperConsole(makeConfig(), {
    runtimeState,
  });
  const address = await developerConsole.listen();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const sessions = await fetch(`${base}/api/sessions`).then((response) =>
      response.json(),
    );
    assert.ok(sessions.sessions.some((session) => session.id === 'session-1'));

    const timeline = await fetch(
      `${base}/api/sessions/session-1/timeline`,
    ).then((response) => response.json());
    assert.equal(timeline.sessionId, 'session-1');
    assert.equal(timeline.transcript[0].kind, 'interaction');
    assert.equal(timeline.transcript[0].trigger, 'link_click');
    assert.equal(timeline.transcript[0].rows[0].title, 'Session planner');
    assert.equal(
      timeline.transcript[0].rows[0].reasoningSummary,
      'Planner summary',
    );
  } finally {
    await developerConsole.close();
  }
});

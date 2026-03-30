import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS } from '../../src/config.mjs';
import {
  createRuntimeState,
  GLOBAL_SESSION_ID,
} from '../../src/runtime-state.mjs';

test('runtime state tracks draft and active config versions independently', () => {
  const runtimeState = createRuntimeState({ config: DEFAULTS });

  runtimeState.updateDraft({
    sessionPlanner: {
      prompt: 'updated session prompt',
    },
  });
  const draftOnly = runtimeState.getRuntimeConfig();
  assert.equal(draftOnly.version, 1);
  assert.equal(
    draftOnly.active.sessionPlanner.prompt.includes('origin web server'),
    true,
  );
  assert.equal(draftOnly.draft.sessionPlanner.prompt, 'updated session prompt');

  const applied = runtimeState.applyDraft();
  assert.equal(applied.version, 2);
  assert.equal(applied.active.sessionPlanner.prompt, 'updated session prompt');
});

test('runtime state redacts cookies, api keys, and page tokens in timeline events', () => {
  const runtimeState = createRuntimeState({ config: DEFAULTS });
  runtimeState.recordEvent({
    type: 'browser.request',
    actor: 'browser',
    sessionId: 'session-1',
    payload: {
      cookie: 'vibe_session=abc',
      apiKey: 'sk-secret-value',
      body: '__vb_page=abc.def',
      html: '<input type="hidden" name="__vb_page" value="abc.def">',
    },
  });

  const [event] = runtimeState.getEvents({ sessionId: 'session-1' });
  assert.equal(event.payload.cookie, '[redacted]');
  assert.equal(event.payload.apiKey, '[redacted]');
  assert.match(event.payload.body, /\[redacted\]/u);
  assert.match(event.payload.html, /\[redacted\]/u);
});

test('runtime state includes a global timeline session summary', () => {
  const runtimeState = createRuntimeState({ config: DEFAULTS });
  runtimeState.recordEvent({
    type: 'browser.request',
    actor: 'browser',
    sessionId: null,
    summary: 'global event',
  });

  const summaries = runtimeState.getSessionSummaries();
  assert.equal(summaries[0].id, GLOBAL_SESSION_ID);
  assert.ok(summaries[0].requestCount >= 1);
});

test('runtime state projects agent-centric transcript entries', () => {
  const runtimeState = createRuntimeState({ config: DEFAULTS });
  runtimeState.recordEvent({
    type: 'browser.request.normalized',
    actor: 'browser',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    trigger: 'form_submit',
    startedAt: 1000,
    endedAt: 1020,
    durationMs: 20,
    payload: {
      path: '/',
    },
  });
  runtimeState.recordEvent({
    type: 'session.plan.input',
    actor: 'session_agent',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    payload: {
      seed_phrase: 'seed',
      request: {
        method: 'GET',
        path: '/',
        headers: [{ name: 'accept', value: 'text/html' }],
      },
      latest_path_state: {
        pageType: 'home',
        pageSummary: 'Welcome page',
        pageInstanceId: 'internal-id',
      },
      site_style_guide: {
        theme_name: 'Console Ledger',
        visual_summary: 'Warm ledger shell.',
      },
    },
  });
  runtimeState.recordEvent({
    type: 'session.plan.output',
    actor: 'session_agent',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    startedAt: 1020,
    endedAt: 1080,
    durationMs: 60,
    payload: {
      attempt: 0,
      output: '{"broken":true}',
      reasoningSummary: 'Planner tried an invalid response.',
      response: {
        model: 'gpt-5.4-mini-2026-03-17',
        usage: {
          input_tokens: 100,
          output_tokens: 25,
          total_tokens: 125,
        },
      },
    },
  });
  runtimeState.recordEvent({
    type: 'session.plan.invalid',
    actor: 'session_agent',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    payload: {
      attempt: 0,
      issues: '1. Broken schema',
    },
  });
  runtimeState.recordEvent({
    type: 'session.plan.output',
    actor: 'session_agent',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    startedAt: 1080,
    endedAt: 1160,
    durationMs: 80,
    payload: {
      attempt: 1,
      output: '{"kind":"page"}',
      reasoningSummary: 'Planner settled on a page response.',
      response: {
        model: 'gpt-5.4-mini-2026-03-17',
        usage: {
          input_tokens: 120,
          output_tokens: 40,
          total_tokens: 160,
        },
      },
    },
  });
  runtimeState.recordEvent({
    type: 'session.plan.parsed',
    actor: 'session_agent',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    payload: {
      attempt: 1,
      parsed: {
        kind: 'page',
        title: 'Home',
        pageType: 'home',
        siteStyleGuide: {
          themeName: 'Console Ledger',
        },
      },
      reasoningSummary: 'Planner settled on a page response.',
    },
  });
  runtimeState.recordEvent({
    type: 'renderer.page.input',
    actor: 'renderer_page',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    payload: {
      seed_phrase: 'seed',
      path: '/',
      page_type: 'home',
      site_style_guide: {
        theme_name: 'Console Ledger',
      },
    },
  });
  runtimeState.recordEvent({
    type: 'renderer.page.output',
    actor: 'renderer_page',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    startedAt: 1160,
    endedAt: 1280,
    durationMs: 120,
    payload: {
      attempt: 0,
      output: '{"html":"<!doctype html>"}',
      reasoningSummary: 'Renderer kept the page compact.',
      response: {
        model: 'gpt-5.4-mini-2026-03-17',
        usage: {
          input_tokens: 140,
          output_tokens: 60,
          total_tokens: 200,
        },
      },
    },
  });
  runtimeState.recordEvent({
    type: 'renderer.page.parsed',
    actor: 'renderer_page',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    payload: {
      attempt: 0,
      parsed: {
        htmlFragment: '<section class="card"><h1>Home</h1></section>',
        hasJavaScript: true,
      },
    },
  });
  runtimeState.recordEvent({
    type: 'renderer.page.final',
    actor: 'server',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    requestId: '1',
    durationMs: 18,
    payload: {
      html: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Home</h1><script>document.body.dataset.ready = "yes";</script></body></html>',
      hasJavascript: true,
      finalizeDurationMs: 18,
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
    endedAt: 1305,
    durationMs: 305,
  });

  const transcript = runtimeState.getTranscript('session-1');

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0].kind, 'interaction');
  assert.equal(transcript[0].trigger, 'form_submit');
  assert.equal(transcript[0].totalDurationMs, 305);
  assert.equal(transcript[0].rows.length, 3);
  assert.equal(transcript[0].rows[0].lane, 'session');
  assert.equal(
    transcript[0].rows[0].reasoningSummary,
    'Planner settled on a page response.',
  );
  assert.equal(transcript[0].rows[0].failedAttempts.length, 1);
  assert.match(transcript[0].rows[0].accounting.label, /tok/u);
  assert.equal(transcript[0].rows[0].input.request.headers, undefined);
  assert.equal(
    transcript[0].rows[0].input.latest_path_state.pageInstanceId,
    undefined,
  );
  assert.equal(transcript[0].rows[1].kind, 'handoff');
  assert.equal(transcript[0].rows[1].label, 'page brief');
  assert.equal(transcript[0].rows[2].lane, 'renderer');
  assert.equal(
    transcript[0].rows[2].previewHtml.includes('document.body.dataset.ready'),
    true,
  );
  assert.equal(transcript[0].rows[2].metadata.hasJavaScript, true);
  assert.equal(transcript[0].timing.breakdown.plannerDurationMs, 140);
  assert.match(runtimeState.getTranscriptSummary('session-1').label, /tok/u);
  assert.equal(
    runtimeState.getTranscriptSummary('session-1').latency.slowestDurationMs,
    305,
  );
});

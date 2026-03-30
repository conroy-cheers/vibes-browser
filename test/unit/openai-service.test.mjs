import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS } from '../../src/config.mjs';
import {
  extractReasoningSummary,
  OpenAIWebserverService,
} from '../../src/openai-service.mjs';

test('session planning falls back to local history when conversation-backed responses are rejected', async () => {
  let responseCalls = 0;
  const payloads = [];
  const client = {
    conversations: {
      async create() {
        return { id: 'conv-123' };
      },
    },
    responses: {
      async create(payload) {
        responseCalls += 1;
        payloads.push(payload);
        if (responseCalls === 1) {
          const error = new Error('unsupported');
          error.code = 'unsupported_parameter';
          error.param = 'conversation';
          throw error;
        }

        assert.equal(payload.store, false);
        assert.ok(Array.isArray(payload.input));
        return {
          output_text: JSON.stringify({
            kind: 'page',
            page_type: 'fallback',
            page_summary: 'Fallback summary',
            path_state_summary: 'Fallback path state',
            title: 'Fallback',
            design_brief: 'Render a fallback page.',
            links: [],
            forms: [],
            interactive_requirement: {
              required: false,
              reason: 'No interaction needed.',
              behaviors: [],
            },
            site_style_guide: {
              theme_name: 'Fallback',
              visual_summary: 'Warm bulletin styling.',
              palette: {
                page_bg: '#f4efe3',
                panel_bg: '#fffdf8',
                panel_alt_bg: '#f0e6d2',
                text: '#2a251f',
                muted_text: '#6a5e4f',
                accent: '#8f2d1f',
                accent_alt: '#c85d35',
                border: '#bba98b',
              },
              typography: {
                body_stack: 'sans',
                display_stack: 'humanist',
                heading_treatment: 'plain',
                density: 'standard',
              },
              components: {
                nav_style: 'pills',
                button_style: 'solid',
                input_style: 'boxed',
                card_style: 'filled',
                table_style: 'grid',
              },
              chrome: {
                site_title: 'Fallback',
                tagline: 'Fallback styling',
                footer_tone: 'Filed locally',
              },
              motifs: ['notice'],
            },
          }),
        };
      },
    },
  };

  const service = new OpenAIWebserverService(
    {
      ...DEFAULTS,
      apiKey: 'test',
      systemPrompt: 'test prompt',
    },
    { client },
  );

  const session = await service.createSession('seed');
  const response = await service.planSessionResponse(session, {
    request: { method: 'GET', path: '/' },
  });
  const second = await service.planSessionResponse(session, {
    request: { method: 'GET', path: '/next' },
  });

  assert.equal(session.mode, 'local');
  assert.equal(session.conversationId, null);
  assert.match(response.output_text, /Fallback/u);
  assert.match(second.output_text, /Fallback/u);
  assert.ok(session.history.length >= 4);
  assert.equal(payloads.at(-1).input.at(-2).role, 'assistant');
  assert.equal(payloads.at(-1).input.at(-2).content[0].type, 'output_text');
  assert.equal(payloads.at(-1).model, DEFAULTS.plannerModel);
  assert.equal(payloads.at(-1).reasoning.summary, 'auto');
});

test('renderer requests are stateless and return raw HTML text', async () => {
  const payloads = [];
  const client = {
    conversations: {
      async create() {
        return { id: 'conv-ignored' };
      },
    },
    responses: {
      async create(payload) {
        payloads.push(payload);
        return {
          output_text:
            '<section class="card"><h1>Renderer</h1><p>Body</p></section>',
        };
      },
    },
  };

  const service = new OpenAIWebserverService(
    {
      ...DEFAULTS,
      apiKey: 'test',
      systemPrompt: 'test prompt',
    },
    { client },
  );

  await service.renderPage({
    path: '/',
    title: 'Renderer',
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].store, false);
  assert.equal(payloads[0].conversation, undefined);
  assert.equal(payloads[0].text.verbosity, 'low');
  assert.equal(payloads[0].reasoning, undefined);
  assert.equal(payloads[0].max_output_tokens, DEFAULTS.rendererMaxOutputTokens);
  assert.match(payloads[0].prompt_cache_key, /^vb:/u);
});

test('renderer requests use the runtime-config scaffolding in their instructions', async () => {
  const payloads = [];
  const client = {
    conversations: {
      async create() {
        return { id: 'conv-ignored' };
      },
    },
    responses: {
      async create(payload) {
        payloads.push(payload);
        return {
          output_text:
            '<section class="card"><h1>Renderer</h1><p>Body</p></section>',
        };
      },
    },
  };

  const service = new OpenAIWebserverService(
    {
      ...DEFAULTS,
      apiKey: 'test',
      systemPrompt: 'test prompt',
    },
    { client },
  );

  await service.renderPage(
    {
      path: '/',
      title: 'Renderer',
    },
    {
      version: 7,
      sessionPlanner: {
        model: 'unused-model',
        reasoningEffort: 'low',
        prompt: 'unused',
      },
      renderer: {
        model: 'gpt-5',
        reasoningEffort: 'high',
        pagePrompt: 'page prompt',
        scaffolding: 'scaffolding notes',
      },
    },
  );

  assert.match(payloads[0].instructions, /page prompt/u);
  assert.match(payloads[0].instructions, /scaffolding notes/u);
  assert.equal(payloads[0].model, 'gpt-5');
  assert.equal(payloads[0].reasoning.effort, 'high');
});

test('extractReasoningSummary joins reasoning summary text from output items', () => {
  const summary = extractReasoningSummary({
    output: [
      {
        type: 'reasoning',
        summary: [{ text: 'First trace.' }, { text: 'Second trace.' }],
      },
    ],
  });

  assert.equal(summary, 'First trace.\n\nSecond trace.');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS } from '../../src/config.mjs';
import { OpenAIWebserverService } from '../../src/openai-service.mjs';

test('service falls back to local history when conversation-backed responses are rejected', async () => {
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
            status: 200,
            headers: [{ name: 'content-type', value: 'text/html' }],
            body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ok</title></head><body><p>Fallback</p></body></html>',
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
  const response = await service.generateResponse(session, {
    method: 'GET',
    path: '/',
    query: {},
    headers: [],
    bodyText: '',
  });
  const second = await service.generateResponse(session, {
    method: 'GET',
    path: '/next',
    query: {},
    headers: [],
    bodyText: '',
  });

  assert.equal(session.mode, 'local');
  assert.equal(session.conversationId, null);
  assert.match(response.output_text, /Fallback/u);
  assert.match(second.output_text, /Fallback/u);
  assert.ok(session.history.length >= 4);
  assert.equal(payloads.at(-1).input.at(-2).role, 'assistant');
  assert.equal(payloads.at(-1).input.at(-2).content[0].type, 'output_text');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../src/app.mjs';
import { DEFAULTS } from '../../src/config.mjs';

function makeConfig() {
  return {
    ...DEFAULTS,
    host: '127.0.0.1',
    port: 0,
    verbose: false,
  };
}

function stubService() {
  return {
    async createSession(seedPhrase) {
      return { conversationId: `conv-${seedPhrase}` };
    },
    async generateResponse() {
      return {
        output_text: JSON.stringify({
          status: 200,
          headers: [{ name: 'content-type', value: 'text/html' }],
          body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Test</title></head><body><p>Stub page</p></body></html>',
        }),
      };
    },
    async repairResponse() {
      throw new Error('repair should not be called');
    },
  };
}

test('bootstrap form renders before a session exists', async () => {
  const app = createApp(makeConfig(), { openaiService: stubService() });
  const address = await app.listen();
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Vibes Browser/u);
  await app.close();
});

test('session bootstrap redirects and subsequent page is model-backed', async () => {
  const app = createApp(makeConfig(), { openaiService: stubService() });
  const address = await app.listen();
  const start = await fetch(`http://127.0.0.1:${address.port}/_session/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'phrase=hello+world',
    redirect: 'manual',
  });

  assert.equal(start.status, 303);
  const cookie = start.headers.get('set-cookie');
  assert.ok(cookie);

  const page = await fetch(`http://127.0.0.1:${address.port}/`, {
    headers: { cookie },
  });
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Stub page/u);
  assert.equal(
    page.headers.get('cache-control'),
    'private, no-store, no-cache, max-age=0, must-revalidate',
  );
  await app.close();
});

test('invalid first model response triggers one repair attempt', async () => {
  let first = true;
  const app = createApp(makeConfig(), {
    openaiService: {
      async createSession() {
        return { conversationId: 'conv-test' };
      },
      async generateResponse() {
        return {
          output_text:
            '{"status":200,"headers":[{"name":"content-type","value":"text/html"}],"body":"oops"}',
        };
      },
      async repairResponse() {
        first = false;
        return {
          output_text: JSON.stringify({
            status: 200,
            headers: [{ name: 'content-type', value: 'text/html' }],
            body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixed</title></head><body><p>Fixed</p></body></html>',
          }),
        };
      },
    },
  });

  const address = await app.listen();
  const start = await fetch(`http://127.0.0.1:${address.port}/_session/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'phrase=repair',
    redirect: 'manual',
  });
  const cookie = start.headers.get('set-cookie');
  const page = await fetch(`http://127.0.0.1:${address.port}/`, {
    headers: { cookie },
  });
  assert.equal(page.status, 200);
  assert.equal(first, false);
  await app.close();
});

test('redirect response with empty body is served without repair', async () => {
  let repairCalled = false;
  const app = createApp(makeConfig(), {
    openaiService: {
      async createSession() {
        return { conversationId: 'conv-redirect' };
      },
      async generateResponse() {
        return {
          output_text: JSON.stringify({
            status: 303,
            headers: [{ name: 'location', value: '/sign-up?denied=1' }],
            body: '',
          }),
        };
      },
      async repairResponse() {
        repairCalled = true;
        throw new Error('repair should not be called');
      },
    },
  });

  const address = await app.listen();
  const start = await fetch(`http://127.0.0.1:${address.port}/_session/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'phrase=redirect',
    redirect: 'manual',
  });
  const cookie = start.headers.get('set-cookie');
  const response = await fetch(`http://127.0.0.1:${address.port}/sign-up`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'email=test%40example.com',
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/sign-up?denied=1');
  assert.equal(repairCalled, false);
  await app.close();
});

test('invalid model response can recover after multiple lint-guided retries', async () => {
  let repairAttempts = 0;
  const repairInputs = [];
  const app = createApp(makeConfig(), {
    openaiService: {
      async createSession() {
        return { conversationId: 'conv-retry' };
      },
      async generateResponse() {
        return {
          output_text:
            '{"status":200,"headers":[{"name":"content-type","value":"text/html"}],"body":"still broken"}',
        };
      },
      async repairResponse(session, requestInfo, previousOutput, issues) {
        repairAttempts += 1;
        repairInputs.push({
          previousOutput,
          issues,
          method: requestInfo.method,
          path: requestInfo.path,
        });
        if (repairAttempts === 1) {
          return {
            output_text:
              '{"status":200,"headers":[{"name":"content-type","value":"text/html"}],"body":"<html><body>better</body></html>"}',
          };
        }

        return {
          output_text: JSON.stringify({
            status: 200,
            headers: [{ name: 'content-type', value: 'text/html' }],
            body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixed</title></head><body><p>Fixed after retries</p></body></html>',
          }),
        };
      },
    },
  });

  const address = await app.listen();
  const start = await fetch(`http://127.0.0.1:${address.port}/_session/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'phrase=retry-loop',
    redirect: 'manual',
  });
  const cookie = start.headers.get('set-cookie');
  const page = await fetch(`http://127.0.0.1:${address.port}/`, {
    headers: { cookie },
  });
  const html = await page.text();

  assert.equal(page.status, 200);
  assert.equal(repairAttempts, 2);
  assert.equal(repairInputs.length, 2);
  assert.equal(repairInputs[0].method, 'GET');
  assert.equal(repairInputs[0].path, '/');
  assert.match(repairInputs[0].previousOutput, /still broken/u);
  assert.match(repairInputs[0].issues, /doctype/u);
  assert.match(
    repairInputs[1].previousOutput,
    /<html><body>better<\/body><\/html>/u,
  );
  assert.match(repairInputs[1].issues, /doctype/u);
  assert.match(html, /Fixed after retries/u);
  await app.close();
});

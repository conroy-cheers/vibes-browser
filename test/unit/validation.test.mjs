import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS } from '../../src/config.mjs';
import { normalizeEnvelope } from '../../src/validation.mjs';

test('normalizeEnvelope injects cache headers and pageshow reload', () => {
  const envelope = normalizeEnvelope(
    {
      status: 200,
      headers: [{ name: 'content-type', value: 'text/html' }],
      body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>x</title></head><body><p>Hello</p></body></html>',
    },
    DEFAULTS.responseBudgets,
  );

  assert.equal(envelope.status, 200);
  assert.equal(
    envelope.headers.get('cache-control'),
    'private, no-store, no-cache, max-age=0, must-revalidate',
  );
  assert.match(envelope.body, /event\.persisted/u);
});

test('normalizeEnvelope rejects unsupported content types', () => {
  assert.throws(() => {
    normalizeEnvelope(
      {
        status: 200,
        headers: [{ name: 'content-type', value: 'image/png' }],
        body: 'nope',
      },
      DEFAULTS.responseBudgets,
    );
  }, /Unsupported content-type/u);
});

test('normalizeEnvelope rejects invalid javascript', () => {
  assert.throws(() => {
    normalizeEnvelope(
      {
        status: 200,
        headers: [{ name: 'content-type', value: 'application/javascript' }],
        body: 'function {',
      },
      DEFAULTS.responseBudgets,
    );
  });
});

test('normalizeEnvelope accepts redirects with Location and empty body', () => {
  const envelope = normalizeEnvelope(
    {
      status: 303,
      headers: [{ name: 'location', value: '/sign-up?denied=1' }],
      body: '',
    },
    DEFAULTS.responseBudgets,
  );

  assert.equal(envelope.status, 303);
  assert.equal(envelope.headers.get('location'), '/sign-up?denied=1');
  assert.equal(envelope.headers.get('content-type'), undefined);
});

test('normalizeEnvelope rejects body on bodyless statuses', () => {
  assert.throws(() => {
    normalizeEnvelope(
      {
        status: 204,
        headers: [],
        body: 'not allowed',
      },
      DEFAULTS.responseBudgets,
    );
  }, /must not include a body/u);
});

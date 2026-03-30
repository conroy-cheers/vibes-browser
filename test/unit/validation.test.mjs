import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS } from '../../src/config.mjs';
import {
  finalizeRenderedHtml,
  normalizeEnvelope,
} from '../../src/validation.mjs';

function buildStyleGuide(overrides = {}) {
  return {
    themeName: 'Validation Ledger',
    visualSummary: 'Warm beige shell with compact cards.',
    palette: {
      pageBg: '#f4efe3',
      panelBg: '#fffdf8',
      panelAltBg: '#f0e6d2',
      text: '#2a251f',
      mutedText: '#6a5e4f',
      accent: '#8f2d1f',
      accentAlt: '#c85d35',
      border: '#bba98b',
    },
    typography: {
      bodyStack: 'sans',
      displayStack: 'humanist',
      headingTreatment: 'plain',
      density: 'standard',
    },
    components: {
      navStyle: 'pills',
      buttonStyle: 'solid',
      inputStyle: 'boxed',
      cardStyle: 'filled',
      tableStyle: 'grid',
    },
    chrome: {
      siteTitle: 'Validation Ledger',
      tagline: 'Shell continuity',
      footerTone: 'Filed by validation tests.',
    },
    motifs: ['ledger'],
    ...overrides,
  };
}

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

test('finalizeRenderedHtml injects form tokens and preserves inline scripts', () => {
  const html = finalizeRenderedHtml(
    '<section class="card"><h1>Join</h1><form method="POST" action="/join" data-vb-form-id="join-form"><input type="email" name="email"><button type="submit">Join</button></form><script>document.body.dataset.ready = "yes";</script></section>',
    {
      title: 'Join',
      siteStyleGuide: buildStyleGuide(),
      forms: [
        {
          formId: 'join-form',
          method: 'POST',
          action: '/join',
          purpose: 'Join',
          submitLabel: 'Join',
          fields: [
            {
              name: 'email',
              label: 'Email',
              type: 'email',
              required: true,
              placeholder: '',
            },
          ],
        },
      ],
      formTokens: { 'join-form': 'signed-token' },
      requireInlineScripts: true,
    },
  );

  assert.match(html, /name="__vb_page" value="signed-token"/u);
  assert.match(html, /document\.body\.dataset\.ready/u);
  assert.match(html, /event\.persisted/u);
});

test('finalizeRenderedHtml infers missing data-vb-form-id attributes by action and method', () => {
  const html = finalizeRenderedHtml(
    '<section class="card"><h1>Join</h1><form method="POST" action="/join"><input type="email" name="email"><button type="submit">Join</button></form></section>',
    {
      title: 'Join',
      siteStyleGuide: buildStyleGuide(),
      forms: [
        {
          formId: 'join-form',
          method: 'POST',
          action: '/join',
          purpose: 'Join',
          submitLabel: 'Join',
          fields: [
            {
              name: 'email',
              label: 'Email',
              type: 'email',
              required: true,
              placeholder: '',
            },
          ],
        },
      ],
      formTokens: { 'join-form': 'signed-token' },
    },
  );

  assert.match(html, /data-vb-form-id="join-form"/u);
  assert.match(html, /name="__vb_page" value="signed-token"/u);
});

test('finalizeRenderedHtml appends missing declared forms as fallback scaffolding', () => {
  const html = finalizeRenderedHtml(
    '<section class="card"><h1>Join</h1><p>Visible body</p></section>',
    {
      title: 'Join',
      siteStyleGuide: buildStyleGuide(),
      forms: [
        {
          formId: 'join-form',
          method: 'POST',
          action: '/join',
          purpose: 'Join',
          submitLabel: 'Join',
          fields: [
            {
              name: 'email',
              label: 'Email',
              type: 'email',
              required: true,
              placeholder: '',
            },
          ],
        },
      ],
      formTokens: { 'join-form': 'signed-token' },
    },
  );

  assert.match(html, /data-vb-form-id="join-form"/u);
  assert.match(html, /action="\/join"/u);
  assert.match(html, /name="email"/u);
  assert.match(html, /name="__vb_page" value="signed-token"/u);
});

test('finalizeRenderedHtml appends missing declared fields inside a rendered form', () => {
  const html = finalizeRenderedHtml(
    '<section class="card"><h1>Reorder</h1><form method="POST" action="/reorder" data-vb-form-id="reorder"><input type="text" name="customer_id"><input type="text" name="previous_order"><button type="submit">Reorder</button></form></section>',
    {
      title: 'Reorder',
      siteStyleGuide: buildStyleGuide(),
      forms: [
        {
          formId: 'reorder',
          method: 'POST',
          action: '/reorder',
          purpose: 'Quick reorder',
          submitLabel: 'Reorder',
          fields: [
            {
              name: 'customer_id',
              label: 'Customer ID',
              type: 'text',
              required: false,
              placeholder: '',
            },
            {
              name: 'previous_order',
              label: 'Previous order',
              type: 'text',
              required: false,
              placeholder: '',
            },
            {
              name: 'rush',
              label: 'Rush note',
              type: 'text',
              required: false,
              placeholder: 'Need it immediately',
            },
          ],
        },
      ],
      formTokens: { reorder: 'signed-token' },
    },
  );

  assert.match(html, /data-vb-form-id="reorder"/u);
  assert.match(html, /name="rush"/u);
  assert.match(html, /placeholder="Need it immediately"/u);
  assert.match(html, /name="__vb_page" value="signed-token"/u);
});

test('finalizeRenderedHtml scopes page-level style blocks inside the shell', () => {
  const html = finalizeRenderedHtml(
    '<style>h1 { color: purple; }</style><section class="card"><h1>Scoped</h1><p>Visible text</p></section>',
    {
      title: 'Scoped',
      siteStyleGuide: buildStyleGuide(),
      forms: [],
      formTokens: {},
    },
  );

  assert.match(html, /\[data-vb-page="true"\] h1/u);
  assert.match(html, /data-vb-shell="header"/u);
});

test('finalizeRenderedHtml rejects page styles that target the outer shell', () => {
  assert.throws(() => {
    finalizeRenderedHtml(
      '<style>body { background: red; }</style><section><h1>Nope</h1><p>Visible text</p></section>',
      {
        title: 'Bad',
        siteStyleGuide: buildStyleGuide(),
      },
    );
  }, /shell-level selectors/u);
});

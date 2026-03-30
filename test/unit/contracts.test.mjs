import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanupRenderedHtmlOutput,
  parseSessionDecision,
  parseRenderedPageResult,
  StreamingHtmlCleanup,
} from '../../src/contracts.mjs';

test('parseRenderedPageResult strips fenced html wrappers', () => {
  const html = parseRenderedPageResult(
    '```html\n<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Hello</h1></body></html>\n```',
  );

  assert.equal(html, '<h1>Hello</h1>');
  assert.doesNotMatch(html, /^```/u);
});

test('cleanupRenderedHtmlOutput drops leading prose before html', () => {
  const html = cleanupRenderedHtmlOutput(
    'Here is the page you asked for:\n\n<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Hello</h1></body></html>',
  );

  assert.equal(html, '<h1>Hello</h1>');
  assert.doesNotMatch(html, /Here is the page/u);
});

test('cleanupRenderedHtmlOutput decodes simple json html wrappers', () => {
  const html = cleanupRenderedHtmlOutput(
    '{"html":"<!doctype html><html><head><meta charset=\\"utf-8\\"></head><body><h1>Hello</h1></body></html>"}',
  );

  assert.equal(html, '<h1>Hello</h1>');
  assert.doesNotMatch(html, /^\{/u);
});

test('StreamingHtmlCleanup can recover html from chunked fenced output', () => {
  const cleaner = new StreamingHtmlCleanup();
  const chunks = [
    '```html\nHere is th',
    'e page\n<!doctype html><html><head><meta charset="utf-8"></head>',
    '<body><h1>Hello</h1></body></html>\n```',
  ];

  const cleaned = `${cleaner.push(chunks[0])}${cleaner.push(chunks[1])}${cleaner.push(chunks[2])}${cleaner.finish()}`;
  assert.match(cleaned.trim(), /^<!doctype html>/iu);
  assert.doesNotMatch(cleaned, /```/u);
});

test('parseRenderedPageResult leaves fragment-only renderer output intact', () => {
  const html = parseRenderedPageResult(
    '<section class="card"><h1>Hello</h1><p>World</p></section>',
  );

  assert.equal(
    html,
    '<section class="card"><h1>Hello</h1><p>World</p></section>',
  );
});

test('parseSessionDecision accepts root-relative redirect locations', () => {
  const decision = parseSessionDecision(
    JSON.stringify({
      kind: 'redirect',
      page_type: '',
      page_summary: '',
      path_state_summary: '',
      title: '',
      design_brief: '',
      location: '/quote-confirmation?status=received',
      message: 'Thanks.',
      links: [],
      forms: [],
      interactive_requirement: {
        required: false,
        reason: '',
        behaviors: [],
      },
    }),
  );

  assert.equal(decision.kind, 'redirect');
  assert.equal(decision.location, '/quote-confirmation?status=received');
});

test('parseSessionDecision rejects prose redirect locations', () => {
  assert.throws(
    () =>
      parseSessionDecision(
        JSON.stringify({
          kind: 'redirect',
          page_type: '',
          page_summary: '',
          path_state_summary: '',
          title: '',
          design_brief: '',
          location: 'Redirecting to quote confirmation',
          message: 'Thanks.',
          links: [],
          forms: [],
          interactive_requirement: {
            required: false,
            reason: '',
            behaviors: [],
          },
        }),
      ),
    /location must be a same-origin path starting with "\/"/u,
  );
});

test('parseSessionDecision defaults missing field and interaction booleans to false', () => {
  const decision = parseSessionDecision(
    JSON.stringify({
      kind: 'page',
      page_type: 'landing',
      page_summary: 'A storefront homepage.',
      path_state_summary: 'At the root.',
      title: 'Metro Dune Depot',
      design_brief: 'Render a storefront landing page.',
      location: '',
      message: '',
      links: [],
      forms: [
        {
          form_id: 'quote_request',
          method: 'GET',
          action: '/quote-request',
          purpose: 'Start a quote flow.',
          submit_label: 'Get Quote',
          fields: [
            {
              name: 'apartment_type',
              label: 'Apartment type',
              type: 'text',
              placeholder: 'Studio',
            },
          ],
        },
      ],
      interactive_requirement: {
        reason: 'Plain navigation and forms are sufficient.',
        behaviors: [],
      },
      site_style_guide: {
        theme_name: 'Urban Sand Emporium',
        visual_summary: 'Warm neighborhood storefront styling.',
        palette: {
          page_bg: '#f3efe3',
          panel_bg: '#fffaf0',
          panel_alt_bg: '#efe3c9',
          text: '#2f2418',
          muted_text: '#6e5b46',
          accent: '#c57b2a',
          accent_alt: '#7a5a3a',
          border: '#c8b08a',
        },
        typography: {
          body_stack: 'sans',
          display_stack: 'sans',
          heading_treatment: 'caps',
          density: 'roomy',
        },
        components: {
          nav_style: 'pills',
          button_style: 'solid',
          input_style: 'boxed',
          card_style: 'bordered',
          table_style: 'lined',
        },
        chrome: {
          site_title: 'Metro Dune Depot',
          tagline: 'Bulk sand for city apartments.',
          footer_tone: 'Confident, neighborly, and ready to deliver.',
        },
        motifs: ['grainy texture'],
      },
    }),
  );

  assert.equal(decision.forms[0].fields[0].required, false);
  assert.equal(decision.interactiveRequirement.required, false);
});

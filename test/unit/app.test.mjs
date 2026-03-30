import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../src/app.mjs';
import { DEFAULTS } from '../../src/config.mjs';
import { createRuntimeState } from '../../src/runtime-state.mjs';

function makeConfig() {
  return {
    ...DEFAULTS,
    host: '127.0.0.1',
    port: 0,
    verbose: false,
  };
}

function buildPageDecision(overrides = {}) {
  return {
    kind: 'page',
    page_type: 'stub_page',
    page_summary: 'A stub page',
    path_state_summary: 'Latest state for the path',
    title: 'Stub page',
    design_brief: 'Render a simple content page with old-web styling.',
    links: [],
    forms: [],
    interactive_requirement: {
      required: false,
      reason: 'No client-side interactivity is needed.',
      behaviors: [],
    },
    site_style_guide: buildStyleGuide(),
    ...overrides,
  };
}

function buildStyleGuide(overrides = {}) {
  return {
    theme_name: 'Warm Bulletin',
    visual_summary: 'Soft beige panels with red accents and compact spacing.',
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
      site_title: 'Stub Site',
      tagline: 'Testing shell continuity',
      footer_tone: 'Filed by the local shell.',
    },
    motifs: ['ledger', 'noticeboard'],
    ...overrides,
  };
}

function buildRenderedPage(overrides = {}) {
  return (
    overrides.html ??
    '<section class="card"><h1>Stub page</h1><p>Stub content</p></section>'
  );
}

function stubService() {
  return {
    async createSession(seedPhrase) {
      return {
        conversationId: `conv-${seedPhrase}`,
        mode: 'local',
        history: [],
      };
    },
    async planSessionResponse() {
      return {
        output_text: JSON.stringify(buildPageDecision()),
      };
    },
    async repairSessionPlan() {
      throw new Error('session repair should not be called');
    },
    async renderPage() {
      return {
        output_text: buildRenderedPage(),
      };
    },
    async repairRenderedPage() {
      throw new Error('renderer page repair should not be called');
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

test('invalid first session plan triggers one repair attempt', async () => {
  let repaired = false;
  const app = createApp(makeConfig(), {
    openaiService: {
      async createSession() {
        return { conversationId: 'conv-test', mode: 'local', history: [] };
      },
      async planSessionResponse() {
        return {
          output_text: '{"kind":"page","title":"Broken"}',
        };
      },
      async repairSessionPlan() {
        repaired = true;
        return {
          output_text: JSON.stringify(buildPageDecision()),
        };
      },
      async renderPage() {
        return {
          output_text: buildRenderedPage(),
        };
      },
      async repairRenderedPage() {
        throw new Error('renderer page repair should not be called');
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
  assert.equal(repaired, true);
  await app.close();
});

test('forms are bound to the exact rendered page instance', async () => {
  const plannerInputs = [];
  const app = createApp(makeConfig(), {
    openaiService: {
      async createSession() {
        return { conversationId: 'conv-form', mode: 'local', history: [] };
      },
      async planSessionResponse(session, plannerRequest) {
        plannerInputs.push(plannerRequest);
        if (plannerRequest.request.path === '/sign-up') {
          return {
            output_text: JSON.stringify({
              kind: 'redirect',
              location: '/thanks',
              message: 'Processed',
            }),
          };
        }

        return {
          output_text: JSON.stringify(
            buildPageDecision({
              page_type: 'signup',
              page_summary: 'A signup page with a single email form.',
              title: 'Join the registry',
              design_brief: 'Render a signup page with one form.',
              forms: [
                {
                  form_id: 'join-form',
                  method: 'POST',
                  action: '/sign-up',
                  purpose: 'Collect an email address for the registry.',
                  submit_label: 'Join',
                  fields: [
                    {
                      name: 'email',
                      label: 'Email',
                      type: 'email',
                      required: true,
                      placeholder: 'name@example.com',
                    },
                  ],
                },
              ],
            }),
          ),
        };
      },
      async repairSessionPlan() {
        throw new Error('session repair should not be called');
      },
      async renderPage() {
        return {
          output_text: buildRenderedPage({
            html: '<section class="card"><h1>Join the registry</h1><form method="POST" action="/sign-up" data-vb-form-id="join-form"><label>Email <input type="email" name="email"></label><button type="submit">Join</button></form></section>',
          }),
        };
      },
      async repairRenderedPage() {
        throw new Error('renderer page repair should not be called');
      },
    },
  });

  const address = await app.listen();
  const start = await fetch(`http://127.0.0.1:${address.port}/_session/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'phrase=form-binding',
    redirect: 'manual',
  });
  const cookie = start.headers.get('set-cookie');
  const page = await fetch(`http://127.0.0.1:${address.port}/`, {
    headers: { cookie },
  });
  const html = await page.text();
  const tokenMatch = html.match(/name="__vb_page" value="([^"]+)"/u);
  assert.ok(tokenMatch);

  const submit = await fetch(`http://127.0.0.1:${address.port}/sign-up`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: `email=test%40example.com&__vb_page=${encodeURIComponent(tokenMatch[1])}`,
    redirect: 'manual',
  });

  assert.equal(submit.status, 303);
  assert.equal(submit.headers.get('location'), '/thanks');
  assert.equal(plannerInputs.at(-1).source_page.form.form_id, 'join-form');
  assert.equal(
    plannerInputs.at(-1).source_page.submission_fields.email,
    'test@example.com',
  );
  await app.close();
});

test('invalid redirect prose is repaired before reaching the browser', async () => {
  let plannerRepairCalls = 0;
  const app = createApp(makeConfig(), {
    openaiService: {
      async createSession() {
        return { conversationId: 'conv-redirect', mode: 'local', history: [] };
      },
      async planSessionResponse(_session, plannerRequest) {
        if (
          plannerRequest.request.method === 'POST' &&
          plannerRequest.request.path === '/contact'
        ) {
          return {
            output_text: JSON.stringify({
              kind: 'redirect',
              page_type: '',
              page_summary: '',
              path_state_summary: '',
              title: '',
              design_brief: '',
              location: 'Redirecting to quote confirmation',
              message: 'Thanks. Your sand consultant is reviewing the request.',
              links: [],
              forms: [],
              interactive_requirement: {
                required: false,
                reason: '',
                behaviors: [],
              },
            }),
          };
        }

        return {
          output_text: JSON.stringify(
            buildPageDecision({
              page_type: 'contact',
              page_summary: 'A quote request page.',
              title: 'Request a sand quote',
              design_brief: 'Render a quote request page with one form.',
              forms: [
                {
                  form_id: 'quote_request',
                  method: 'POST',
                  action: '/contact',
                  purpose: 'Collect a sand quote request.',
                  submit_label: 'Request Quote',
                  fields: [
                    {
                      name: 'quantity',
                      label: 'Quantity',
                      type: 'text',
                      required: true,
                      placeholder: '6 pallets',
                    },
                    {
                      name: 'delivery_notes',
                      label: 'Delivery notes',
                      type: 'textarea',
                      required: false,
                      placeholder: 'stairs only',
                    },
                  ],
                },
              ],
            }),
          ),
        };
      },
      async repairSessionPlan() {
        plannerRepairCalls += 1;
        return {
          output_text: JSON.stringify({
            kind: 'redirect',
            page_type: '',
            page_summary: '',
            path_state_summary: '',
            title: '',
            design_brief: '',
            location: '/quote-confirmation',
            message: 'Thanks. Your sand consultant is reviewing the request.',
            links: [],
            forms: [],
            interactive_requirement: {
              required: false,
              reason: '',
              behaviors: [],
            },
            site_style_guide: buildStyleGuide(),
          }),
        };
      },
      async renderPage() {
        return {
          output_text: buildRenderedPage({
            html: '<section class="card"><h1>Request a sand quote</h1><form method="POST" action="/contact" data-vb-form-id="quote_request"><label>Quantity <input type="text" name="quantity"></label><label>Delivery notes <textarea name="delivery_notes"></textarea></label><button type="submit">Request Quote</button></form></section>',
          }),
        };
      },
      async repairRenderedPage() {
        throw new Error('renderer page repair should not be called');
      },
    },
  });

  const address = await app.listen();
  const start = await fetch(`http://127.0.0.1:${address.port}/_session/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'phrase=sand',
    redirect: 'manual',
  });
  const cookie = start.headers.get('set-cookie');
  const page = await fetch(`http://127.0.0.1:${address.port}/contact`, {
    headers: { cookie },
  });
  const html = await page.text();
  const tokenMatch = html.match(/name="__vb_page" value="([^"]+)"/u);
  assert.ok(tokenMatch);

  const submit = await fetch(`http://127.0.0.1:${address.port}/contact`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: `quantity=${encodeURIComponent('6 pallets')}&delivery_notes=${encodeURIComponent('stairs only')}&__vb_page=${encodeURIComponent(tokenMatch[1])}`,
    redirect: 'manual',
  });

  assert.equal(submit.status, 303);
  assert.equal(submit.headers.get('location'), '/quote-confirmation');
  assert.equal(plannerRepairCalls, 1);
  await app.close();
});

test('invalid page token returns a stale-page response', async () => {
  let plannerCalls = 0;
  const app = createApp(makeConfig(), {
    openaiService: {
      async createSession() {
        return { conversationId: 'conv-stale', mode: 'local', history: [] };
      },
      async planSessionResponse() {
        plannerCalls += 1;
        return {
          output_text: JSON.stringify(
            buildPageDecision({
              forms: [
                {
                  form_id: 'join-form',
                  method: 'POST',
                  action: '/sign-up',
                  purpose: 'Collect an email address.',
                  submit_label: 'Join',
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
            }),
          ),
        };
      },
      async repairSessionPlan() {
        throw new Error('session repair should not be called');
      },
      async renderPage() {
        return {
          output_text: buildRenderedPage({
            html: '<section class="card"><h1>Join</h1><form method="POST" action="/sign-up" data-vb-form-id="join-form"><input type="email" name="email"><button type="submit">Join</button></form></section>',
          }),
        };
      },
      async repairRenderedPage() {
        throw new Error('renderer page repair should not be called');
      },
    },
  });

  const address = await app.listen();
  const start = await fetch(`http://127.0.0.1:${address.port}/_session/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'phrase=stale',
    redirect: 'manual',
  });
  const cookie = start.headers.get('set-cookie');
  const response = await fetch(`http://127.0.0.1:${address.port}/sign-up`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'email=test%40example.com&__vb_page=definitely-invalid',
  });
  const html = await response.text();

  assert.equal(response.status, 409);
  assert.match(html, /Stale Page/u);
  assert.equal(plannerCalls, 0);
  await app.close();
});

test('renderer can inline JavaScript directly into the returned HTML', async () => {
  const app = createApp(makeConfig(), {
    openaiService: {
      async createSession() {
        return { conversationId: 'conv-js', mode: 'local', history: [] };
      },
      async planSessionResponse() {
        return {
          output_text: JSON.stringify(
            buildPageDecision({
              page_type: 'map',
              page_summary: 'An interactive map page.',
              title: 'Map',
              design_brief: 'Render a page with a status region for a map.',
              interactive_requirement: {
                required: true,
                reason: 'The map needs interaction.',
                behaviors: ['toggle layers'],
              },
              site_style_guide: buildStyleGuide({
                theme_name: 'Signal Atlas',
                visual_summary: 'Dark signal-board panels with orange accents.',
              }),
            }),
          ),
        };
      },
      async repairSessionPlan() {
        throw new Error('session repair should not be called');
      },
      async renderPage() {
        return {
          output_text: buildRenderedPage({
            html: '<section class="card"><h1>Map</h1><p id="status">Loading</p><script>document.getElementById("status").textContent = "Interactive map";</script></section>',
          }),
        };
      },
      async repairRenderedPage() {
        throw new Error('renderer page repair should not be called');
      },
    },
  });

  const address = await app.listen();
  const start = await fetch(`http://127.0.0.1:${address.port}/_session/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'phrase=interactive',
    redirect: 'manual',
  });
  const cookie = start.headers.get('set-cookie');
  const page = await fetch(`http://127.0.0.1:${address.port}/`, {
    headers: { cookie },
  });
  const html = await page.text();

  assert.match(html, /Interactive map/u);
  assert.doesNotMatch(html, /<script src=/u);
  await app.close();
});

test('runtime timeline captures browser, planner, and renderer events', async () => {
  const runtimeState = createRuntimeState({ config: makeConfig() });
  const app = createApp(makeConfig(), {
    openaiService: stubService(),
    runtimeState,
  });
  const address = await app.listen();

  try {
    const start = await fetch(
      `http://127.0.0.1:${address.port}/_session/start`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'phrase=timeline',
        redirect: 'manual',
      },
    );
    const cookie = start.headers.get('set-cookie');
    await fetch(`http://127.0.0.1:${address.port}/`, {
      headers: { cookie },
    });

    const sessionId = [...runtimeState.sessions.keys()][0];
    const events = runtimeState.getEvents({ sessionId });
    const eventTypes = new Set(events.map((event) => event.type));

    assert.ok(eventTypes.has('browser.request'));
    assert.ok(eventTypes.has('session.plan.input'));
    assert.ok(eventTypes.has('session.plan.parsed'));
    assert.ok(eventTypes.has('renderer.page.input'));
    assert.ok(eventTypes.has('renderer.page.final'));
    assert.ok(eventTypes.has('browser.response'));
  } finally {
    await app.close();
  }
});

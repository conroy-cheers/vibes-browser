import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { chromium } from 'playwright-core';

import { createApp } from '../../src/app.mjs';
import {
  parseRenderedPageResult,
  parseSessionDecision,
} from '../../src/contracts.mjs';
import { DEFAULTS, loadDotEnv } from '../../src/config.mjs';
import { OpenAIWebserverService } from '../../src/openai-service.mjs';
import { createRuntimeState } from '../../src/runtime-state.mjs';
import { finalizeRenderedHtml } from '../../src/validation.mjs';
import { RENDERER_FIXTURES } from './renderer-fixtures.mjs';

const TEST_STYLE_GUIDE = {
  themeName: 'Live Fixture Ledger',
  visualSummary: 'Warm shell with red accents and filled cards.',
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
    siteTitle: 'Live Fixture Ledger',
    tagline: 'Renderer smoke test shell',
    footerTone: 'Filed by the live smoke suite.',
  },
  motifs: ['ledger'],
};

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) {
    return process.env.CHROMIUM_PATH;
  }

  const result = spawnSync('bash', ['-lc', 'which chromium'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

test('live OpenAI smoke flow', async (context) => {
  if (process.env.LIVE_OPENAI_TEST !== '1') {
    context.skip('LIVE_OPENAI_TEST is not enabled');
  }

  loadDotEnv(process.cwd());
  if (!process.env.OPENAI_API_KEY) {
    context.skip('OPENAI_API_KEY is not configured');
  }

  const executablePath = chromiumPath();
  if (!executablePath) {
    context.skip('chromium is not installed');
  }

  const config = {
    ...DEFAULTS,
    host: '127.0.0.1',
    port: 0,
    apiKey: process.env.OPENAI_API_KEY,
    verbose: false,
  };

  const app = createApp(config, {
    openaiService: new OpenAIWebserverService(config),
  });
  const address = await app.listen();
  const browser = await chromium.launch({ executablePath, headless: true });

  try {
    const page = await browser.newPage();
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push(message.text()));

    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.fill(
      'textarea[name="phrase"]',
      'Build a two-page personal homepage with one contact form and minimal styling.',
    );
    await page.click('button[type="submit"]');
    await page.waitForSelector('body');
    await page.waitForLoadState('networkidle');

    const content = await page.content();
    assert.match(content, /<!doctype html>/iu);
    assert.equal(consoleMessages.length, 0);
  } finally {
    await browser.close();
    await app.close();
  }
});

test('live rich seeds can render a first page', async (context) => {
  if (process.env.LIVE_OPENAI_TEST !== '1') {
    context.skip('LIVE_OPENAI_TEST is not enabled');
  }

  loadDotEnv(process.cwd());
  if (!process.env.OPENAI_API_KEY) {
    context.skip('OPENAI_API_KEY is not configured');
  }

  const executablePath = chromiumPath();
  if (!executablePath) {
    context.skip('chromium is not installed');
  }

  const config = {
    ...DEFAULTS,
    host: '127.0.0.1',
    port: 0,
    apiKey: process.env.OPENAI_API_KEY,
    verbose: false,
  };

  const app = createApp(config, {
    openaiService: new OpenAIWebserverService(config),
  });
  const address = await app.listen();
  const browser = await chromium.launch({ executablePath, headless: true });

  try {
    for (const fixture of RENDERER_FIXTURES) {
      await context.test(fixture.name, async () => {
        const page = await browser.newPage();
        const consoleMessages = [];
        page.on('console', (message) => consoleMessages.push(message.text()));

        await page.goto(`http://127.0.0.1:${address.port}/`);
        await page.fill('textarea[name="phrase"]', fixture.seed);
        await page.click('button[type="submit"]');
        await page.waitForSelector('body', { timeout: 120000 });
        await page.waitForLoadState('networkidle', { timeout: 120000 });

        const content = await page.content();
        const title = await page.title();
        const heading = await page
          .locator('h1, h2')
          .first()
          .textContent()
          .catch(() => null);

        assert.match(
          content,
          /<!doctype html>/iu,
          `fixture ${fixture.name} should render a full document`,
        );
        assert.notEqual(
          title,
          'Internal Server Error',
          `fixture ${fixture.name} should not 500 on the first page load`,
        );
        assert.ok(
          heading,
          `fixture ${fixture.name} should show a visible heading on the first page load`,
        );
        assert.equal(
          consoleMessages.length,
          0,
          `fixture ${fixture.name} should not emit browser console errors on the first page load`,
        );

        await page.close();
      });
    }
  } finally {
    await browser.close();
    await app.close();
  }
});

test('live renderer fixtures with gpt-5.4-nano and no reasoning', async (context) => {
  if (process.env.LIVE_OPENAI_TEST !== '1') {
    context.skip('LIVE_OPENAI_TEST is not enabled');
  }

  loadDotEnv(process.cwd());
  if (!process.env.OPENAI_API_KEY) {
    context.skip('OPENAI_API_KEY is not configured');
  }

  const executablePath = chromiumPath();
  if (!executablePath) {
    context.skip('chromium is not installed');
  }

  const config = {
    ...DEFAULTS,
    host: '127.0.0.1',
    port: 0,
    apiKey: process.env.OPENAI_API_KEY,
    verbose: false,
  };

  const runtimeState = createRuntimeState({ config });
  runtimeState.updateDraft({
    sessionPlanner: {
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
    },
    renderer: {
      model: 'gpt-5.4-nano',
      reasoningEffort: 'none',
    },
  });
  const runtimeConfig = runtimeState.applyDraft().active;
  const openaiService = new OpenAIWebserverService(config);
  const browser = await chromium.launch({ executablePath, headless: true });

  try {
    for (const fixture of RENDERER_FIXTURES) {
      await context.test(fixture.name, async () => {
        const renderPayload = {
          ...fixture.renderPayload,
          site_style_guide: {
            theme_name: TEST_STYLE_GUIDE.themeName,
            visual_summary: TEST_STYLE_GUIDE.visualSummary,
            palette: {
              page_bg: TEST_STYLE_GUIDE.palette.pageBg,
              panel_bg: TEST_STYLE_GUIDE.palette.panelBg,
              panel_alt_bg: TEST_STYLE_GUIDE.palette.panelAltBg,
              text: TEST_STYLE_GUIDE.palette.text,
              muted_text: TEST_STYLE_GUIDE.palette.mutedText,
              accent: TEST_STYLE_GUIDE.palette.accent,
              accent_alt: TEST_STYLE_GUIDE.palette.accentAlt,
              border: TEST_STYLE_GUIDE.palette.border,
            },
            typography: {
              body_stack: TEST_STYLE_GUIDE.typography.bodyStack,
              display_stack: TEST_STYLE_GUIDE.typography.displayStack,
              heading_treatment: TEST_STYLE_GUIDE.typography.headingTreatment,
              density: TEST_STYLE_GUIDE.typography.density,
            },
            components: {
              nav_style: TEST_STYLE_GUIDE.components.navStyle,
              button_style: TEST_STYLE_GUIDE.components.buttonStyle,
              input_style: TEST_STYLE_GUIDE.components.inputStyle,
              card_style: TEST_STYLE_GUIDE.components.cardStyle,
              table_style: TEST_STYLE_GUIDE.components.tableStyle,
            },
            chrome: {
              site_title: TEST_STYLE_GUIDE.chrome.siteTitle,
              tagline: TEST_STYLE_GUIDE.chrome.tagline,
              footer_tone: TEST_STYLE_GUIDE.chrome.footerTone,
            },
            motifs: TEST_STYLE_GUIDE.motifs,
          },
        };
        const finalizedHtml = await renderFixtureHtml({
          openaiService,
          renderPayload,
          runtimeConfig: {
            version: 1,
            ...runtimeConfig,
          },
          fixture,
        });

        const page = await browser.newPage();
        const consoleMessages = [];
        page.on('console', (message) => consoleMessages.push(message.text()));
        await page.setContent(finalizedHtml, { waitUntil: 'load' });
        await page.waitForLoadState('networkidle');

        assert.match(
          await page.content(),
          /doctype html/iu,
          `fixture ${fixture.name} should render a full document`,
        );
        assert.equal(
          consoleMessages.length,
          0,
          `fixture ${fixture.name} should not emit browser console errors`,
        );
        const heading = await page.locator('h1, h2').first().textContent();
        assert.ok(
          heading,
          `fixture ${fixture.name} should render visible headings`,
        );
        await page.close();
      });
    }
  } finally {
    await browser.close();
  }
});

async function renderFixtureHtml({
  openaiService,
  renderPayload,
  runtimeConfig,
  fixture,
}) {
  let response = await openaiService.renderPage(renderPayload, runtimeConfig);
  let rawOutput = response.output_text;

  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      const rawHtml = parseRenderedPageResult(rawOutput);
      return finalizeRenderedHtml(rawHtml, {
        title: fixture.renderPayload.title,
        siteStyleGuide: TEST_STYLE_GUIDE,
        forms: fixture.renderPayload.forms,
        formTokens: Object.fromEntries(
          fixture.renderPayload.forms.map((form) => [
            form.formId,
            'test-token',
          ]),
        ),
        requireInlineScripts:
          fixture.renderPayload.interactive_requirement.required,
      });
    } catch (error) {
      if (attempt >= 2) {
        error.message = `${fixture.name}: ${error.message}\nRaw output preview: ${String(rawOutput).slice(0, 600)}`;
        throw error;
      }

      response = await openaiService.repairRenderedPage(
        renderPayload,
        rawOutput,
        error.message,
        runtimeConfig,
      );
      rawOutput = response.output_text;
    }
  }

  throw new Error(`Fixture ${fixture.name} exceeded renderer repair attempts.`);
}

test('live planner redirects sand quote submissions to valid paths', async (context) => {
  if (process.env.LIVE_OPENAI_TEST !== '1') {
    context.skip('LIVE_OPENAI_TEST is not enabled');
  }

  loadDotEnv(process.cwd());
  if (!process.env.OPENAI_API_KEY) {
    context.skip('OPENAI_API_KEY is not configured');
  }

  const config = {
    ...DEFAULTS,
    host: '127.0.0.1',
    port: 0,
    apiKey: process.env.OPENAI_API_KEY,
    verbose: false,
  };

  const runtimeState = createRuntimeState({ config });
  runtimeState.updateDraft({
    sessionPlanner: {
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
    },
  });
  const runtimeConfig = runtimeState.applyDraft().active;
  const openaiService = new OpenAIWebserverService(config);
  const seedPhrase =
    'A website that aggressively tries to sell absurd quantities of sand to apartment dwellers';
  const plannerRequest = {
    seed_phrase: seedPhrase,
    request: {
      method: 'POST',
      path: '/contact',
      query: {},
      headers: [
        {
          name: 'content-type',
          value: 'application/x-www-form-urlencoded',
        },
        {
          name: 'referer',
          value: 'http://127.0.0.1/contact',
        },
      ],
      body_text:
        'unit_type=studio&quantity=6+pallets&delivery_notes=stairs+only&contact=conroy%40example.com',
      form_data: {
        unit_type: 'studio',
        quantity: '6 pallets',
        delivery_notes: 'stairs only',
        contact: 'conroy@example.com',
      },
    },
    latest_path_state: {
      pageType: 'contact',
      pageSummary:
        'Contact page for requesting quotes and delivery estimates for absurdly large sand orders.',
      pageInstanceId: 'page-contact',
      updatedAt: new Date().toISOString(),
    },
    source_page: {
      page_instance_id: 'page-contact',
      path: '/contact',
      page_type: 'contact',
      page_summary:
        'Contact page for requesting quotes and delivery estimates for absurdly large sand orders.',
      title: 'Request a Sand Quote',
      form: {
        form_id: 'quote_request',
        method: 'POST',
        action: '/contact',
        purpose:
          'Collect a quote request for apartment sand delivery and follow-up contact.',
        fields: [
          {
            name: 'unit_type',
            label: 'Unit type',
            type: 'text',
            required: false,
            placeholder: 'studio',
          },
          {
            name: 'quantity',
            label: 'Desired quantity',
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
          {
            name: 'contact',
            label: 'Email or phone',
            type: 'text',
            required: true,
            placeholder: 'conroy@example.com',
          },
        ],
      },
      submission_fields: {
        unit_type: 'studio',
        quantity: '6 pallets',
        delivery_notes: 'stairs only',
        contact: 'conroy@example.com',
      },
    },
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await openaiService.createSession(
      seedPhrase,
      runtimeConfig,
    );
    const response = await openaiService.planSessionResponse(
      session,
      plannerRequest,
      runtimeConfig,
    );
    const rawOutput = response.output_text;
    const decision = parseSessionDecision(rawOutput);

    assert.equal(
      decision.kind,
      'redirect',
      `attempt ${attempt + 1} should redirect after a successful quote submission. Raw output: ${rawOutput}`,
    );
    assert.match(
      decision.location,
      /^\/(?!\/)\S*$/u,
      `attempt ${attempt + 1} should produce a root-relative redirect path. Raw output: ${rawOutput}`,
    );
  }
});

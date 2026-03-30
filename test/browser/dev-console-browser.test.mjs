import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { chromium } from 'playwright-core';

import { createApp } from '../../src/app.mjs';
import { DEFAULTS } from '../../src/config.mjs';
import { createDeveloperConsole } from '../../src/dev-console.mjs';
import { createRuntimeState } from '../../src/runtime-state.mjs';

function chromiumPath() {
  const result = spawnSync('bash', ['-lc', 'which chromium'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

test('developer console shows lane-based timelines, transcript defaults, and edits nested runtime config', async (context) => {
  const executablePath = chromiumPath();
  if (!executablePath) {
    context.skip('chromium is not installed');
  }

  const runtimeState = createRuntimeState({ config: DEFAULTS });
  const openaiService = {
    async createSession() {
      return { conversationId: 'conv-console', mode: 'local', history: [] };
    },
    async planSessionResponse() {
      return {
        id: 'resp-planner',
        model: 'gpt-5.4-mini-2026-03-17',
        _vbMeta: {
          startedAt: 1000,
          endedAt: 1120,
          durationMs: 120,
        },
        usage: {
          input_tokens: 210,
          output_tokens: 95,
          total_tokens: 305,
        },
        output: [
          {
            type: 'reasoning',
            summary: [{ text: 'Planner reasoning summary.' }],
          },
          {
            type: 'message',
            content: [
              {
                text: JSON.stringify({
                  kind: 'page',
                  page_type: 'console_demo',
                  page_summary: 'A console demo page.',
                  path_state_summary: 'Latest console demo state.',
                  title: 'Console demo',
                  design_brief: 'Render a demo page with visible navigation.',
                  links: [
                    { href: '/next', label: 'Next', description: 'Continue' },
                  ],
                  forms: [],
                  interactive_requirement: {
                    required: true,
                    reason: 'Preview should exercise script rendering.',
                    behaviors: ['mark preview ready'],
                  },
                  site_style_guide: {
                    theme_name: 'Console Ledger',
                    visual_summary:
                      'Warm ledger shell with filled cards and red accents.',
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
                      site_title: 'Console demo',
                      tagline: 'Timeline preview',
                      footer_tone: 'Shell footer note',
                    },
                    motifs: ['ledger'],
                  },
                }),
              },
            ],
          },
        ],
      };
    },
    async repairSessionPlan() {
      throw new Error('session repair should not run');
    },
    async renderPage() {
      return {
        id: 'resp-page',
        model: 'gpt-5.4-mini-2026-03-17',
        _vbMeta: {
          startedAt: 1120,
          endedAt: 1295,
          durationMs: 175,
        },
        usage: {
          input_tokens: 180,
          output_tokens: 130,
          total_tokens: 310,
        },
        output: [
          {
            type: 'reasoning',
            summary: [{ text: 'Renderer page reasoning summary.' }],
          },
          {
            type: 'message',
            content: [
              {
                text: '<section class="card"><h1>Console demo</h1><p id="status">Visible content</p><a href="/next">Next</a><script>document.querySelector("#status").textContent = "Preview ready";</script></section>',
              },
            ],
          },
        ],
      };
    },
    async repairRenderedPage() {
      throw new Error('renderer repair should not run');
    },
  };

  const app = createApp(
    { ...DEFAULTS, host: '127.0.0.1', port: 0 },
    { openaiService, runtimeState },
  );
  const developerConsole = createDeveloperConsole(
    { ...DEFAULTS, consoleHost: '127.0.0.1', consolePort: 0 },
    { runtimeState },
  );
  const [appAddress, consoleAddress] = await Promise.all([
    app.listen(),
    developerConsole.listen(),
  ]);
  const browser = await chromium.launch({ executablePath, headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${appAddress.port}/`);
    await page.fill('textarea[name="phrase"]', 'console browser seed');
    await page.click('button[type="submit"]');
    await page.waitForSelector('h1');

    const consolePage = await browser.newPage();
    await consolePage.goto(`http://127.0.0.1:${consoleAddress.port}/`);
    await consolePage.waitForSelector('#sessions button');
    await consolePage.click('#sessions button');
    await consolePage.waitForSelector('.timeline-lane-label');
    await consolePage.waitForSelector('details[data-entry-id]');

    const timelineText = await consolePage.textContent('#timeline');
    assert.match(timelineText ?? '', /Session planner/u);
    assert.match(
      (await consolePage.textContent('.timeline-lanes')) ?? '',
      /Session Planner[\s\S]*Renderer/u,
    );
    assert.match(
      timelineText ?? '',
      /Direct visit|Link click|Form submit|Redirect follow/u,
    );
    assert.match(timelineText ?? '', /processing:/u);
    assert.match(timelineText ?? '', /page brief/u);
    assert.match(timelineText ?? '', /Planner reasoning summary/u);
    assert.doesNotMatch(timelineText ?? '', /request=/u);
    assert.doesNotMatch(timelineText ?? '', /session=/u);

    const entryOpenStates = await consolePage.$$eval(
      'details[data-entry-id]',
      (nodes) => nodes.map((node) => node.hasAttribute('open')),
    );
    assert.deepEqual(entryOpenStates, [true, true]);
    assert.match(timelineText ?? '', /tok/u);

    const rawHtmlInitiallyOpen = await consolePage.$eval(
      'details[data-section-key$=":output:html_fragment"]',
      (node) => node.hasAttribute('open'),
    );
    assert.equal(rawHtmlInitiallyOpen, false);

    await consolePage.click('details[data-section-key$=":input"] > summary');
    await consolePage.waitForSelector('details[data-json-path]', {
      state: 'attached',
    });
    await consolePage.waitForTimeout(2600);
    const openAfterRefresh = await consolePage.$eval(
      'details[data-entry-id]',
      (node) => node.hasAttribute('open'),
    );
    assert.equal(openAfterRefresh, true);

    const rendererPageEntry = consolePage
      .locator('details[data-entry-id]')
      .nth(1);
    await consolePage.waitForSelector('.preview-frame', { state: 'attached' });
    const previewText = await consolePage
      .frameLocator('.preview-frame')
      .locator('#status')
      .textContent();
    assert.equal(previewText, 'Preview ready');

    const summaryText = await consolePage.textContent('#timelineSummary');
    assert.match(summaryText ?? '', /Session totals/u);
    assert.match(summaryText ?? '', /tok/u);
    assert.match(summaryText ?? '', /\$/u);
    assert.match(summaryText ?? '', /avg/u);

    await page.reload({ waitUntil: 'networkidle' });
    await consolePage.waitForTimeout(2600);
    const scrollBeforeUpdate = await consolePage.$eval(
      '.timeline-scroll',
      (node) => {
        node.style.height = '12rem';
        node.scrollTop = 180;
        return node.scrollTop;
      },
    );
    assert.ok(scrollBeforeUpdate > 0);
    await page.reload({ waitUntil: 'networkidle' });
    await consolePage.waitForTimeout(2600);
    const scrollAfterUpdate = await consolePage.$eval(
      '.timeline-scroll',
      (node) => node.scrollTop,
    );
    assert.ok(scrollAfterUpdate > 0);
    assert.ok(Math.abs(scrollAfterUpdate - scrollBeforeUpdate) < 120);

    const summaryBottom = await consolePage.$eval(
      '#timelineSummary',
      (node) => {
        const rect = node.getBoundingClientRect();
        return Math.round(window.innerHeight - rect.bottom);
      },
    );
    assert.ok(summaryBottom >= 0);
    assert.ok(summaryBottom < 40);

    const widthBefore = await consolePage.$eval('#configPanel', (node) =>
      Math.round(node.getBoundingClientRect().width),
    );
    const handle = await consolePage.locator('#configResize').boundingBox();
    assert.ok(handle);
    await consolePage.mouse.move(handle.x + handle.width / 2, handle.y + 12);
    await consolePage.mouse.down();
    await consolePage.mouse.move(handle.x - 120, handle.y + 12, {
      steps: 6,
    });
    await consolePage.mouse.up();
    const widthAfter = await consolePage.$eval('#configPanel', (node) =>
      Math.round(node.getBoundingClientRect().width),
    );
    assert.ok(widthAfter > widthBefore);

    await consolePage.click('#rendererTab');
    await consolePage.waitForSelector('#rendererScaffolding', {
      state: 'visible',
    });
    await consolePage.selectOption('#rendererModel', 'gpt-5.4');
    await consolePage.selectOption('#rendererReasoningEffort', 'medium');
    await consolePage.fill('#rendererScaffolding', 'Updated from browser test');
    await consolePage.click('#applyConfig');
    await consolePage.waitForFunction(() =>
      document
        .querySelector('#configStatus')
        ?.textContent.includes('Active version 2'),
    );

    await consolePage.fill('#rendererScaffolding', 'throwaway local edit');
    await consolePage.click('#resetConfig');
    await consolePage.waitForFunction(() => {
      const textarea = document.querySelector('#rendererScaffolding');
      return textarea && textarea.value === 'Updated from browser test';
    });
  } finally {
    await browser.close();
    await Promise.all([app.close(), developerConsole.close()]);
  }
});

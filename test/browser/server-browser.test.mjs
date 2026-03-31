import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { chromium } from 'playwright-core';

import { createApp } from '../../src/app.mjs';
import { DEFAULTS } from '../../src/config.mjs';

function chromiumPath() {
  const result = spawnSync('bash', ['-lc', 'which chromium'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function buildStyleGuide() {
  return {
    theme_name: 'Signal Board',
    visual_summary: 'Warm beige shell with red accents.',
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
      site_title: 'Browser demo',
      tagline: 'Testing continuity',
      footer_tone: 'Filed by the shell.',
    },
    motifs: ['notices'],
  };
}

test('browser flow renders generated page without console errors', async (context) => {
  const executablePath = chromiumPath();
  if (!executablePath) {
    context.skip('chromium is not installed');
  }

  const openaiService = {
    async createSession() {
      return { conversationId: 'conv-browser', mode: 'local', history: [] };
    },
    async planSessionResponse() {
      return {
        output_text: JSON.stringify({
          kind: 'page',
          page_type: 'browser_demo',
          page_summary: 'A browser demo page with interactive status text.',
          path_state_summary: 'Latest browser demo state.',
          title: 'Browser page',
          design_brief: 'Render a page with a heading and a status element.',
          links: [],
          forms: [],
          interactive_requirement: {
            required: true,
            reason: 'The page should prove that JS assets execute.',
            behaviors: ['update status text'],
          },
          site_style_guide: buildStyleGuide(),
        }),
      };
    },
    async repairSessionPlan() {
      throw new Error('session repair should not run');
    },
    async renderPage() {
      return {
        output_text:
          '<section class="card"><h1>Browser page</h1><p id="status">loading</p><script>document.querySelector("#status").textContent = "interactive";</script></section>',
      };
    },
    async repairRenderedPage() {
      throw new Error('renderer page repair should not run');
    },
  };

  const app = createApp(
    { ...DEFAULTS, host: '127.0.0.1', port: 0, verbose: false },
    { openaiService },
  );
  const address = await app.listen();
  const browser = await chromium.launch({ executablePath, headless: true });

  try {
    const page = await browser.newPage();
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push(message.text()));

    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.fill('textarea[name="phrase"]', 'browser seed');
    await page.click('button[type="submit"]');
    await page.waitForSelector('h1');
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent === 'interactive',
    );

    const heading = await page.textContent('h1');
    assert.equal(heading, 'Browser page');
    assert.deepEqual(consoleMessages, []);
  } finally {
    await browser.close();
    await app.close();
  }
});

test('browser flow keeps shell styling stable across page navigations in one session', async (context) => {
  const executablePath = chromiumPath();
  if (!executablePath) {
    context.skip('chromium is not installed');
  }

  const styleGuide = buildStyleGuide();
  const openaiService = {
    async createSession() {
      return { conversationId: 'conv-shell', mode: 'local', history: [] };
    },
    async planSessionResponse(_session, request) {
      const isNext = request.request.path === '/next';
      return {
        output_text: JSON.stringify({
          kind: 'page',
          page_type: isNext ? 'browser_demo_next' : 'browser_demo_home',
          page_summary: isNext ? 'Next page.' : 'First page.',
          path_state_summary: 'Stable shell state.',
          title: isNext ? 'Second page' : 'First page',
          design_brief:
            'Render a page with a heading, copy, and a visible button.',
          links: isNext
            ? [{ href: '/', label: 'Back', description: 'Return home' }]
            : [{ href: '/next', label: 'Next', description: 'Move ahead' }],
          forms: [],
          interactive_requirement: {
            required: false,
            reason: 'No JavaScript needed.',
            behaviors: [],
          },
          site_style_guide: styleGuide,
        }),
      };
    },
    async repairSessionPlan() {
      throw new Error('session repair should not run');
    },
    async renderPage(payload) {
      return {
        output_text:
          payload.path === '/next'
            ? '<section class="card"><h1>Second page</h1><p>Different content, same shell.</p><a href="/">Back</a><button type="button">Second action</button></section>'
            : '<section class="card"><h1>First page</h1><p>Initial content.</p><a href="/next">Next</a><button type="button">Primary action</button></section>',
      };
    },
    async repairRenderedPage() {
      throw new Error('renderer page repair should not run');
    },
  };

  const app = createApp(
    { ...DEFAULTS, host: '127.0.0.1', port: 0, verbose: false },
    { openaiService },
  );
  const address = await app.listen();
  const browser = await chromium.launch({ executablePath, headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.fill('textarea[name="phrase"]', 'browser continuity seed');
    await page.click('button[type="submit"]');
    await page.waitForSelector('h1');

    const before = await page.evaluate(() => {
      const mainButton = document.querySelector('[data-vb-page="true"] button');
      const pageRoot = document.querySelector('[data-vb-page="true"]');
      const bodyStyle = getComputedStyle(document.body);
      const buttonStyle = getComputedStyle(mainButton);
      const pageRootStyle = getComputedStyle(pageRoot);
      return {
        bodyBg: bodyStyle.backgroundColor,
        buttonBg: buttonStyle.backgroundColor,
        pageBg: pageRootStyle.backgroundColor,
        pageBorder: pageRootStyle.border,
      };
    });

    await page.click('a[href="/next"]');
    await page.waitForURL(`http://127.0.0.1:${address.port}/next`);
    await page.waitForSelector('h1');

    const after = await page.evaluate(() => {
      const mainButton = document.querySelector('[data-vb-page="true"] button');
      const pageRoot = document.querySelector('[data-vb-page="true"]');
      const bodyStyle = getComputedStyle(document.body);
      const buttonStyle = getComputedStyle(mainButton);
      const pageRootStyle = getComputedStyle(pageRoot);
      return {
        bodyBg: bodyStyle.backgroundColor,
        buttonBg: buttonStyle.backgroundColor,
        pageBg: pageRootStyle.backgroundColor,
        pageBorder: pageRootStyle.border,
      };
    });

    assert.deepEqual(after, before);
  } finally {
    await browser.close();
    await app.close();
  }
});

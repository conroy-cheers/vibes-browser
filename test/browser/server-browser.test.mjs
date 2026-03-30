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

test('browser flow renders generated page without console errors', async (context) => {
  const executablePath = chromiumPath();
  if (!executablePath) {
    context.skip('chromium is not installed');
  }

  const openaiService = {
    async createSession() {
      return { conversationId: 'conv-browser' };
    },
    async generateResponse(session, requestInfo) {
      if (requestInfo.path === '/app.js') {
        return {
          output_text: JSON.stringify({
            status: 200,
            headers: [
              { name: 'content-type', value: 'application/javascript' },
            ],
            body: 'document.querySelector("#status").textContent = "interactive";',
          }),
        };
      }

      return {
        output_text: JSON.stringify({
          status: 200,
          headers: [{ name: 'content-type', value: 'text/html' }],
          body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Browser</title></head><body><h1>Browser page</h1><p id="status">loading</p><script src="/app.js"></script></body></html>',
        }),
      };
    },
    async repairResponse() {
      throw new Error('repair should not run');
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

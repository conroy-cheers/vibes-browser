import test from 'node:test';
import assert from 'node:assert/strict';

import { chromium } from 'playwright-core';

import { createApp } from '../../src/app.mjs';
import { DEFAULTS, loadDotEnv } from '../../src/config.mjs';
import { OpenAIWebserverService } from '../../src/openai-service.mjs';

test('live OpenAI smoke flow', async (context) => {
  if (process.env.LIVE_OPENAI_TEST !== '1') {
    context.skip('LIVE_OPENAI_TEST is not enabled');
  }

  loadDotEnv(process.cwd());
  if (!process.env.OPENAI_API_KEY) {
    context.skip('OPENAI_API_KEY is not configured');
  }

  const executablePath = '/etc/profiles/per-user/conroy/bin/chromium';
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

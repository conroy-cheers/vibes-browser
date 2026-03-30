import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';

import OpenAI from 'openai';
import { chromium } from 'playwright-core';

import { createApp } from '../../src/app.mjs';
import { DEFAULTS, loadDotEnv } from '../../src/config.mjs';
import { OpenAIWebserverService } from '../../src/openai-service.mjs';
import { createRuntimeState } from '../../src/runtime-state.mjs';
import { RENDERER_FIXTURES } from './renderer-fixtures.mjs';

const USER_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'action_id', 'field_values', 'reason'],
  properties: {
    kind: {
      type: 'string',
      enum: ['click_link', 'submit_form'],
    },
    action_id: {
      type: 'string',
      minLength: 1,
      maxLength: 80,
    },
    field_values: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
          },
          value: {
            type: 'string',
            minLength: 0,
            maxLength: 200,
          },
        },
      },
    },
    reason: {
      type: 'string',
      minLength: 1,
      maxLength: 240,
    },
  },
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

test('live interaction latency benchmark report', async (context) => {
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
  const activeConfig = runtimeState.getActiveRuntimeConfig();

  const openaiService = new OpenAIWebserverService(config);
  const simulatorClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: config.apiBase,
  });

  const app = createApp(config, {
    openaiService,
    runtimeState,
  });
  const address = await app.listen();
  const browser = await chromium.launch({ executablePath, headless: true });
  const report = {
    generatedAt: new Date().toISOString(),
    appBaseUrl: `http://127.0.0.1:${address.port}`,
    simulator: {
      model: 'gpt-5.4-nano',
      reasoningEffort: 'low',
    },
    appModels: {
      sessionPlanner: {
        model: activeConfig.sessionPlanner.model,
        reasoningEffort: activeConfig.sessionPlanner.reasoningEffort,
      },
      renderer: {
        model: activeConfig.renderer.model,
        reasoningEffort: activeConfig.renderer.reasoningEffort,
      },
    },
    interactions: [],
    skipped: [],
  };

  try {
    const seeds = RENDERER_FIXTURES.map((fixture) => fixture.seed);
    for (const seed of seeds) {
      const page = await browser.newPage();
      try {
        await page.goto(report.appBaseUrl);
        await page.fill('textarea[name="phrase"]', seed);
        await page.click('button[type="submit"]', { noWaitAfter: true });
        await waitForSettledPage(page);

        const sessionId = await waitForSessionId(runtimeState, seed);
        let seenInteractions = runtimeState.getTranscript(sessionId).length;

        for (const desiredKind of ['click_link', 'submit_form']) {
          const snapshot = await collectPageActions(page);
          const candidates =
            desiredKind === 'click_link' ? snapshot.links : snapshot.forms;
          if (!candidates.length) {
            report.skipped.push({
              seed,
              desiredKind,
              reason: 'no_candidates',
              snapshot,
            });
            continue;
          }

          const simulatorStartedAt = performance.now();
          const choice = await chooseUserAction(
            simulatorClient,
            snapshot,
            desiredKind,
          );
          const simulatorEndedAt = performance.now();
          const selected = selectAction(choice, snapshot, desiredKind);
          if (!selected) {
            report.skipped.push({
              seed,
              desiredKind,
              reason: 'invalid_simulator_choice',
              snapshot,
              choice,
            });
            continue;
          }

          try {
            const measured = await measureInteraction({
              page,
              action: selected,
              runtimeState,
              sessionId,
              previousInteractionCount: seenInteractions,
            });
            seenInteractions += 1;

            report.interactions.push({
              seed,
              desiredKind,
              simulatorChoice: choice,
              simulatorLatencyMs: simulatorEndedAt - simulatorStartedAt,
              action: selected,
              ...measured,
            });
          } catch (error) {
            report.skipped.push({
              seed,
              desiredKind,
              reason: 'interaction_timeout',
              action: selected,
              error: error.message,
            });
          }
        }

        await page.close();
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
    await app.close();
  }

  await fs.mkdir(path.join(process.cwd(), 'test-results'), { recursive: true });
  await fs.writeFile(
    path.join(process.cwd(), 'test-results', 'latency-benchmark.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );

  console.log('LATENCY_BENCHMARK ' + JSON.stringify(report, null, 2));
  assert.ok(report.interactions.length >= 1);
});

async function waitForSessionId(runtimeState, seedPhrase) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const session of runtimeState.sessions.values()) {
      if (session.seedPhrase === seedPhrase) {
        return session.id;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for session ${seedPhrase}`);
}

async function chooseUserAction(client, snapshot, desiredKind) {
  const response = await client.responses.create({
    model: 'gpt-5.4-nano',
    store: false,
    input: [
      {
        type: 'message',
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: [
              'You simulate a user choosing the next browser action from structured page data.',
              'Return only JSON matching the schema.',
              'Choose exactly one action from the provided candidates.',
              'If asked for a form submission, provide concise plausible field values.',
            ].join('\n'),
          },
        ],
      },
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              desired_kind: desiredKind,
              page: snapshot,
            }),
          },
        ],
      },
    ],
    reasoning: {
      effort: 'low',
    },
    text: {
      format: {
        type: 'json_schema',
        name: 'simulated_user_action',
        strict: true,
        schema: USER_ACTION_SCHEMA,
      },
    },
    max_output_tokens: 400,
    truncation: 'auto',
  });

  return JSON.parse(response.output_text);
}

async function collectPageActions(page) {
  return page.evaluate(() => {
    const cleanText = (value) =>
      String(value || '')
        .replace(/\s+/gu, ' ')
        .trim();

    const links = [...document.querySelectorAll('a[href]')]
      .map((link, index) => {
        const href = link.getAttribute('href') || '';
        if (
          !href ||
          href.startsWith('#') ||
          href.startsWith('javascript:') ||
          href.startsWith('mailto:')
        ) {
          return null;
        }

        let resolved;
        try {
          resolved = new URL(href, location.href);
        } catch {
          return null;
        }

        const resolvedPath = resolved.pathname + resolved.search;
        if (
          resolved.origin !== location.origin ||
          resolvedPath === location.pathname + location.search
        ) {
          return null;
        }
        const actionId = `link-${index}`;
        link.setAttribute('data-vb-bench-id', actionId);
        return {
          actionId,
          kind: 'click_link',
          href: resolvedPath,
          label: cleanText(link.textContent).slice(0, 100) || resolved.pathname,
        };
      })
      .filter(Boolean)
      .slice(0, 12);

    const forms = [...document.querySelectorAll('form')]
      .map((form, index) => {
        const fields = [...form.querySelectorAll('input, textarea, select')]
          .map((field) => {
            const name = field.getAttribute('name') || '';
            if (!name || name === '__vb_page') {
              return null;
            }
            return {
              name,
              type:
                field.tagName.toLowerCase() === 'textarea'
                  ? 'textarea'
                  : field.getAttribute('type') || 'text',
              label:
                cleanText(
                  field.closest('label')?.textContent ||
                    field.getAttribute('aria-label') ||
                    field.getAttribute('placeholder') ||
                    name,
                ).slice(0, 100) || name,
              placeholder: cleanText(field.getAttribute('placeholder') || ''),
              required: field.required,
            };
          })
          .filter(Boolean);
        if (!fields.length) {
          return null;
        }

        const actionId = `form-${index}`;
        form.setAttribute('data-vb-bench-id', actionId);
        return {
          actionId,
          kind: 'submit_form',
          method: (form.getAttribute('method') || 'GET').toUpperCase(),
          action: (() => {
            const rawAction = form.getAttribute('action') || location.pathname;
            try {
              const resolved = new URL(rawAction, location.href);
              return resolved.origin === location.origin
                ? resolved.pathname + resolved.search
                : location.pathname;
            } catch {
              return location.pathname;
            }
          })(),
          submitLabel:
            cleanText(
              form.querySelector('button[type="submit"], input[type="submit"]')
                ?.textContent ||
                form
                  .querySelector('input[type="submit"]')
                  ?.getAttribute('value') ||
                'Submit',
            ) || 'Submit',
          fields,
        };
      })
      .filter(Boolean)
      .slice(0, 6);

    return {
      path: location.pathname + location.search,
      title: document.title,
      headings: [...document.querySelectorAll('h1, h2, h3')]
        .map((node) => cleanText(node.textContent))
        .filter(Boolean)
        .slice(0, 8),
      links,
      forms,
    };
  });
}

function selectAction(choice, snapshot, desiredKind) {
  const candidates =
    desiredKind === 'click_link' ? snapshot.links : snapshot.forms;
  const selected =
    candidates.find((candidate) => candidate.actionId === choice.action_id) ??
    candidates[0] ??
    null;
  if (!selected) {
    return null;
  }

  return {
    ...selected,
    fieldValues: normalizeFieldValues(
      selected,
      Object.fromEntries(
        (choice.field_values ?? []).map((entry) => [entry.name, entry.value]),
      ),
    ),
  };
}

function normalizeFieldValues(action, values) {
  if (action.kind !== 'submit_form') {
    return {};
  }

  return Object.fromEntries(
    action.fields.map((field) => [
      field.name,
      String(values[field.name] ?? defaultFieldValue(field)),
    ]),
  );
}

function defaultFieldValue(field) {
  switch (field.type) {
    case 'email':
      return 'benchmark@example.com';
    case 'number':
      return '3';
    case 'url':
      return 'https://example.com';
    case 'textarea':
      return field.placeholder || `Notes for ${field.label}`;
    default:
      return field.placeholder || `${field.label} sample`;
  }
}

async function measureInteraction({
  page,
  action,
  runtimeState,
  sessionId,
  previousInteractionCount,
}) {
  const startedAt = performance.now();
  if (action.kind === 'click_link') {
    await page
      .locator(`[data-vb-bench-id="${action.actionId}"]`)
      .first()
      .click({ noWaitAfter: true });
  } else {
    const form = page
      .locator(`[data-vb-bench-id="${action.actionId}"]`)
      .first();
    for (const field of action.fields) {
      const value = action.fieldValues[field.name] ?? defaultFieldValue(field);
      const locator = form.locator(`[name="${field.name}"]`).first();
      if (field.type === 'textarea') {
        await locator.fill(value);
      } else {
        await locator.fill(value);
      }
    }
    await form.evaluate((node) => node.requestSubmit());
  }

  await waitForSettledPage(page);
  const endedAt = performance.now();

  const interaction = await waitForInteraction(
    runtimeState,
    sessionId,
    previousInteractionCount + 1,
  );
  return {
    clickToPageloadMs: endedAt - startedAt,
    finalUrl: page.url(),
    interaction,
  };
}

async function waitForInteraction(runtimeState, sessionId, count) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const transcript = runtimeState.getTranscript(sessionId);
    if (transcript.length >= count) {
      return transcript[count - 1];
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for interaction ${count} in ${sessionId}`);
}

async function waitForSettledPage(page, timeout = 120000) {
  await page.waitForSelector('body', { timeout });
  await page.waitForLoadState('networkidle', { timeout });
}

import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_SYSTEM_PROMPT } from './system-prompt.generated.mjs';

export const HTTP_ENVELOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'headers', 'body'],
  properties: {
    status: {
      type: 'integer',
      minimum: 100,
      maximum: 599,
    },
    headers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 128 },
          value: { type: 'string', minLength: 0, maxLength: 4096 },
        },
      },
      maxItems: 32,
    },
    body: {
      type: 'string',
      maxLength: 30000,
    },
  },
};

export function buildSystemPrompt() {
  try {
    const promptPath = path.join(process.cwd(), 'system-prompt.md');
    return fs.readFileSync(promptPath, 'utf8');
  } catch {
    return DEFAULT_SYSTEM_PROMPT;
  }
}

export function buildBootstrapPage(errorMessage = '') {
  const errorHtml = errorMessage
    ? `<p class="error" role="alert">${escapeHtml(errorMessage)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Vibe Browsing</title>
    <style>
      body { font-family: Verdana, Geneva, sans-serif; margin: 2rem auto; max-width: 42rem; padding: 0 1rem; background: #f4f4f4; color: #222; }
      main { background: #fff; border: 1px solid #999; padding: 1.25rem; box-shadow: 2px 2px 0 #ccc; }
      h1 { font-size: 1.6rem; margin-top: 0; }
      p { line-height: 1.4; }
      label { display: block; font-weight: 700; margin-bottom: 0.5rem; }
      textarea { width: 100%; min-height: 8rem; font: inherit; padding: 0.6rem; border: 1px solid #666; box-sizing: border-box; }
      button { margin-top: 0.9rem; padding: 0.55rem 1rem; font: inherit; border: 1px solid #333; background: #e6e6e6; cursor: pointer; }
      .error { color: #8b0000; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Vibes Browser</h1>
      <p>Enter a seed phrase. The model will use it to establish the site concept for this browser session.</p>
      ${errorHtml}
      <form method="post" action="/_session/start">
        <textarea id="phrase" name="phrase" required></textarea>
        <button type="submit">Vibe</button>
      </form>
    </main>
  </body>
</html>`;
}

export function buildErrorPage(title, message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </body>
</html>`;
}

function escapeHtml(input) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

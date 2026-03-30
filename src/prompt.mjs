import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_RENDERER_PAGE_PROMPT,
  DEFAULT_RENDERER_SCAFFOLDING,
  DEFAULT_SESSION_PLANNER_PROMPT,
} from './prompt-defaults.generated.mjs';

export const SITE_STYLE_GUIDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'theme_name',
    'visual_summary',
    'palette',
    'typography',
    'components',
    'chrome',
    'motifs',
  ],
  properties: {
    theme_name: {
      type: 'string',
      minLength: 0,
      maxLength: 32,
    },
    visual_summary: {
      type: 'string',
      minLength: 0,
      maxLength: 120,
    },
    palette: {
      type: 'object',
      additionalProperties: false,
      required: [
        'page_bg',
        'panel_bg',
        'panel_alt_bg',
        'text',
        'muted_text',
        'accent',
        'accent_alt',
        'border',
      ],
      properties: colorProperties(32),
    },
    typography: {
      type: 'object',
      additionalProperties: false,
      required: ['body_stack', 'display_stack', 'heading_treatment', 'density'],
      properties: {
        body_stack: {
          type: 'string',
          enum: ['sans', 'humanist', 'serif', 'mono'],
        },
        display_stack: {
          type: 'string',
          enum: ['sans', 'humanist', 'serif', 'mono'],
        },
        heading_treatment: {
          type: 'string',
          enum: ['plain', 'caps', 'poster'],
        },
        density: {
          type: 'string',
          enum: ['compact', 'standard', 'roomy'],
        },
      },
    },
    components: {
      type: 'object',
      additionalProperties: false,
      required: [
        'nav_style',
        'button_style',
        'input_style',
        'card_style',
        'table_style',
      ],
      properties: {
        nav_style: {
          type: 'string',
          enum: ['pills', 'tabs', 'underline'],
        },
        button_style: {
          type: 'string',
          enum: ['solid', 'outline', 'soft'],
        },
        input_style: {
          type: 'string',
          enum: ['boxed', 'underline', 'soft'],
        },
        card_style: {
          type: 'string',
          enum: ['bordered', 'filled', 'lifted'],
        },
        table_style: {
          type: 'string',
          enum: ['grid', 'lined', 'plain'],
        },
      },
    },
    chrome: {
      type: 'object',
      additionalProperties: false,
      required: ['site_title', 'tagline', 'footer_tone'],
      properties: {
        site_title: {
          type: 'string',
          minLength: 0,
          maxLength: 64,
        },
        tagline: {
          type: 'string',
          minLength: 0,
          maxLength: 72,
        },
        footer_tone: {
          type: 'string',
          minLength: 0,
          maxLength: 72,
        },
      },
    },
    motifs: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 16,
      },
    },
  },
};

export const SESSION_DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'page_type',
    'page_summary',
    'path_state_summary',
    'title',
    'design_brief',
    'location',
    'message',
    'links',
    'forms',
    'interactive_requirement',
    'site_style_guide',
  ],
  properties: {
    kind: {
      type: 'string',
      enum: ['page', 'redirect', 'not_found', 'error_page'],
    },
    page_type: {
      type: 'string',
      minLength: 0,
      maxLength: 32,
    },
    page_summary: {
      type: 'string',
      minLength: 0,
      maxLength: 160,
    },
    path_state_summary: {
      type: 'string',
      minLength: 0,
      maxLength: 140,
    },
    title: {
      type: 'string',
      minLength: 0,
      maxLength: 80,
    },
    design_brief: {
      type: 'string',
      minLength: 0,
      maxLength: 420,
    },
    location: {
      type: 'string',
      minLength: 0,
      maxLength: 256,
      pattern: '^(|\\/(?!\\/)[^\\s]*)$',
    },
    message: {
      type: 'string',
      minLength: 0,
      maxLength: 140,
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['href', 'label', 'description'],
        properties: {
          href: { type: 'string', minLength: 1, maxLength: 256 },
          label: { type: 'string', minLength: 1, maxLength: 56 },
          description: { type: 'string', minLength: 0, maxLength: 72 },
        },
      },
      maxItems: 6,
    },
    forms: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'form_id',
          'method',
          'action',
          'purpose',
          'submit_label',
          'fields',
        ],
        properties: {
          form_id: { type: 'string', minLength: 1, maxLength: 80 },
          method: {
            type: 'string',
            enum: ['GET', 'POST'],
          },
          action: { type: 'string', minLength: 1, maxLength: 256 },
          purpose: { type: 'string', minLength: 1, maxLength: 96 },
          submit_label: { type: 'string', minLength: 1, maxLength: 36 },
          fields: {
            type: 'array',
            maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'label', 'type', 'required', 'placeholder'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 80 },
                label: { type: 'string', minLength: 1, maxLength: 40 },
                type: {
                  type: 'string',
                  enum: [
                    'text',
                    'search',
                    'email',
                    'url',
                    'number',
                    'textarea',
                    'hidden',
                  ],
                },
                required: { type: 'boolean' },
                placeholder: { type: 'string', minLength: 0, maxLength: 48 },
              },
            },
          },
        },
      },
    },
    interactive_requirement: {
      type: 'object',
      additionalProperties: false,
      required: ['required', 'reason', 'behaviors'],
      properties: {
        required: { type: 'boolean' },
        reason: { type: 'string', minLength: 0, maxLength: 80 },
        behaviors: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 48 },
          maxItems: 2,
        },
      },
    },
    site_style_guide: SITE_STYLE_GUIDE_SCHEMA,
  },
};

export const RENDER_PAGE_SCHEMA = {
  type: 'string',
  maxLength: 30000,
};

export const DEFAULT_RENDER_PAGE_PROMPT = DEFAULT_RENDERER_PAGE_PROMPT;

export function buildDefaultRuntimeConfig(config = {}) {
  const sharedModel = resolveSharedModelOverride(config);
  const sharedReasoningEffort = resolveSharedReasoningOverride(config);
  return {
    sessionPlanner: {
      model: sharedModel ?? config.plannerModel ?? 'gpt-5.4-mini',
      reasoningEffort:
        sharedReasoningEffort ?? config.plannerReasoningEffort ?? 'low',
      prompt: loadPromptFile(
        'system-prompt.md',
        config.systemPrompt ?? DEFAULT_SESSION_PLANNER_PROMPT,
      ),
    },
    renderer: {
      model: sharedModel ?? config.rendererModel ?? 'gpt-5.4-nano',
      reasoningEffort:
        sharedReasoningEffort ?? config.rendererReasoningEffort ?? 'none',
      pagePrompt: loadPromptFile(
        'renderer-page-prompt.md',
        DEFAULT_RENDERER_PAGE_PROMPT,
      ),
      scaffolding: loadPromptFile(
        'renderer-scaffolding.md',
        DEFAULT_RENDERER_SCAFFOLDING,
      ),
    },
  };
}

export function buildSystemPrompt() {
  return loadPromptFile('system-prompt.md', DEFAULT_SESSION_PLANNER_PROMPT);
}

export function loadPromptFile(filename, fallback) {
  try {
    const promptPath = path.join(process.cwd(), filename);
    return fs.readFileSync(promptPath, 'utf8');
  } catch {
    return fallback;
  }
}

function resolveSharedModelOverride(config) {
  if (typeof config.modelOverride === 'string' && config.modelOverride.trim()) {
    return config.modelOverride.trim();
  }

  if (
    typeof config.model === 'string' &&
    config.model.trim() &&
    config.model.trim() !== 'gpt-5.4-mini'
  ) {
    return config.model.trim();
  }

  return null;
}

function resolveSharedReasoningOverride(config) {
  if (
    typeof config.reasoningEffortOverride === 'string' &&
    config.reasoningEffortOverride.trim()
  ) {
    return config.reasoningEffortOverride.trim();
  }

  if (
    typeof config.reasoningEffort === 'string' &&
    config.reasoningEffort.trim() &&
    config.reasoningEffort.trim() !== 'low'
  ) {
    return config.reasoningEffort.trim();
  }

  return null;
}

function colorProperties(maxLength) {
  return {
    page_bg: { type: 'string', minLength: 0, maxLength },
    panel_bg: { type: 'string', minLength: 0, maxLength },
    panel_alt_bg: { type: 'string', minLength: 0, maxLength },
    text: { type: 'string', minLength: 0, maxLength },
    muted_text: { type: 'string', minLength: 0, maxLength },
    accent: { type: 'string', minLength: 0, maxLength },
    accent_alt: { type: 'string', minLength: 0, maxLength },
    border: { type: 'string', minLength: 0, maxLength },
  };
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

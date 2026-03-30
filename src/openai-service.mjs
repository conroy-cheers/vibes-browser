import OpenAI from 'openai';

import { serializeError, summarizeResponseUsage } from './logger.mjs';
import {
  buildDefaultRuntimeConfig,
  SESSION_DECISION_SCHEMA,
} from './prompt.mjs';

export class OpenAIWebserverService {
  constructor(config, options = {}) {
    this.config = config;
    this.logger = options.logger ?? createNullLogger();
    this.client =
      options.client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.apiBase,
      });
    this.runtimeConfigProvider =
      options.runtimeConfigProvider ??
      (() => ({
        version: 1,
        ...buildDefaultRuntimeConfig(config),
      }));
  }

  async createSession(seedPhrase, runtimeConfig = this.#getRuntimeConfig()) {
    const history = [userMessage(`Session seed phrase: ${seedPhrase}`)];
    const startedAt = Date.now();
    this.logger.info('session.bootstrap.start', {
      seedBytes: Buffer.byteLength(seedPhrase, 'utf8'),
      configVersion: runtimeConfig.version,
    });

    try {
      const conversation = await this.client.conversations.create({
        items: [
          developerMessage(runtimeConfig.sessionPlanner.prompt),
          history[0],
        ],
      });
      this.logger.info('session.bootstrap.ready', {
        mode: 'conversation',
        conversationId: conversation.id,
        durationMs: Date.now() - startedAt,
      });

      return {
        conversationId: conversation.id,
        seedPhrase,
        mode: 'conversation',
        history,
      };
    } catch (error) {
      if (!isConversationUnsupported(error)) {
        this.logger.error('session.bootstrap.failed', {
          durationMs: Date.now() - startedAt,
          error: serializeError(error),
        });
        throw error;
      }

      this.logger.warn('session.bootstrap.fallback_local_history', {
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      });

      return {
        conversationId: null,
        seedPhrase,
        mode: 'local',
        history,
      };
    }
  }

  async planSessionResponse(session, requestEnvelope) {
    const runtimeConfig = arguments[2] ?? this.#getRuntimeConfig();
    return this.#generateSession(session, requestEnvelope, null, runtimeConfig);
  }

  async repairSessionPlan(
    session,
    requestEnvelope,
    previousOutput,
    errorMessage,
    runtimeConfig = this.#getRuntimeConfig(),
  ) {
    return this.#generateSession(
      session,
      requestEnvelope,
      {
        task: 'session planner',
        previousOutput,
        errorMessage,
        hint: 'Return one valid decision object. For page decisions, include links, forms, and an explicit interactive requirement. For redirect decisions, location must be a same-origin path beginning with "/" and containing no spaces or prose; put any human-readable explanation in message.',
      },
      runtimeConfig,
    );
  }

  async renderPage(renderPayload, runtimeConfig = this.#getRuntimeConfig()) {
    return this.#generateStateless({
      task: 'renderer.page',
      instructions: buildRenderPageInstructions(runtimeConfig),
      model: runtimeConfig.renderer.model,
      reasoningEffort: runtimeConfig.renderer.reasoningEffort,
      payload: renderPayload,
    });
  }

  async repairRenderedPage(
    renderPayload,
    previousOutput,
    errorMessage,
    runtimeConfig = this.#getRuntimeConfig(),
  ) {
    return this.#generateStateless({
      task: 'renderer.page',
      instructions: buildRenderPageInstructions(runtimeConfig),
      model: runtimeConfig.renderer.model,
      reasoningEffort: runtimeConfig.renderer.reasoningEffort,
      payload: renderPayload,
      repairContext: {
        task: 'page renderer',
        previousOutput,
        errorMessage,
        hint: 'Return one valid HTML fragment for the page main content only. Do not return <!doctype html>, <html>, <head>, or <body>. Do not use markdown fences, JSON wrappers, labels, or commentary. Keep the page compact. If space is tight, cut styling first, never visible text or required forms. Render each declared form exactly once with matching data-vb-form-id. The fragment must contain visible text. Inline any required JavaScript directly in script tags and do not use external script src attributes. Any optional style block must only refine the page content and must not target html, body, header, or footer.',
      },
    });
  }

  async #generateSession(
    session,
    requestEnvelope,
    repairContext,
    runtimeConfig = this.#getRuntimeConfig(),
  ) {
    const startedAt = Date.now();
    const message = buildMessage(requestEnvelope, repairContext);

    if (session.mode !== 'local' && session.conversationId) {
      try {
        this.logger.debug('openai.session_plan.start', {
          mode: session.mode,
          conversationId: session.conversationId,
          repair: Boolean(repairContext),
          configVersion: runtimeConfig.version,
        });
        const response = await this.client.responses.create(
          this.#buildSessionRequest({
            session,
            input: [message],
            useConversation: true,
            runtimeConfig,
          }),
        );
        attachResponseMeta(response, startedAt, Date.now());
        this.#appendHistory(session, message, response);
        this.logger.info('openai.session_plan.success', {
          mode: session.mode,
          conversationId: session.conversationId,
          repair: Boolean(repairContext),
          durationMs: Date.now() - startedAt,
          historyLength: session.history.length,
          ...summarizeResponseUsage(response),
        });
        return response;
      } catch (error) {
        if (!isConversationUnsupported(error)) {
          this.logger.error('openai.session_plan.failed', {
            mode: session.mode,
            conversationId: session.conversationId,
            repair: Boolean(repairContext),
            durationMs: Date.now() - startedAt,
            error: serializeError(error),
          });
          throw error;
        }

        this.logger.warn('openai.session_plan.fallback_local_history', {
          mode: session.mode,
          conversationId: session.conversationId,
          repair: Boolean(repairContext),
          durationMs: Date.now() - startedAt,
          error: serializeError(error),
        });
        session.mode = 'local';
        session.conversationId = null;
      }
    }

    this.logger.debug('openai.session_plan.start', {
      mode: 'local',
      repair: Boolean(repairContext),
      historyLength: session.history.length,
      configVersion: runtimeConfig.version,
    });
    const response = await this.client.responses.create(
      this.#buildSessionRequest({
        session,
        input: [
          developerMessage(runtimeConfig.sessionPlanner.prompt),
          ...session.history,
          message,
        ],
        useConversation: false,
        runtimeConfig,
      }),
    );
    attachResponseMeta(response, startedAt, Date.now());
    this.#appendHistory(session, message, response);
    this.logger.info('openai.session_plan.success', {
      mode: 'local',
      repair: Boolean(repairContext),
      durationMs: Date.now() - startedAt,
      historyLength: session.history.length,
      ...summarizeResponseUsage(response),
    });
    return response;
  }

  async #generateStateless({
    task,
    instructions,
    model,
    reasoningEffort,
    payload,
    repairContext,
  }) {
    const startedAt = Date.now();
    this.logger.debug(`${task}.start`, {
      repair: Boolean(repairContext),
    });

    try {
      const response = await this.client.responses.create({
        model,
        instructions,
        input: [buildMessage(payload, repairContext)],
        store: false,
        text: {
          verbosity: 'low',
        },
        ...buildReasoningConfig(reasoningEffort),
        max_output_tokens: this.config.maxOutputTokens,
        truncation: 'auto',
      });
      attachResponseMeta(response, startedAt, Date.now());

      this.logger.info(`${task}.success`, {
        repair: Boolean(repairContext),
        durationMs: Date.now() - startedAt,
        ...summarizeResponseUsage(response),
      });
      return response;
    } catch (error) {
      this.logger.error(`${task}.failed`, {
        repair: Boolean(repairContext),
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      });
      throw error;
    }
  }

  #buildSessionRequest({ session, input, useConversation, runtimeConfig }) {
    return {
      model: runtimeConfig.sessionPlanner.model,
      instructions: runtimeConfig.sessionPlanner.prompt,
      ...buildReasoningConfig(runtimeConfig.sessionPlanner.reasoningEffort),
      ...(useConversation
        ? { conversation: session.conversationId }
        : { store: false }),
      input,
      max_output_tokens: this.config.maxOutputTokens,
      truncation: 'auto',
      text: {
        format: {
          type: 'json_schema',
          name: 'session_decision',
          strict: true,
          schema: SESSION_DECISION_SCHEMA,
        },
      },
    };
  }

  #appendHistory(session, message, response) {
    const assistantText = extractOutputText(response);
    const historyLengthBefore = session.history.length;
    session.history.push(message, assistantMessage(assistantText));
    pruneHistory(session.history);
    this.logger.debug('session.history.updated', {
      mode: session.mode,
      historyLengthBefore,
      historyLengthAfter: session.history.length,
    });
  }

  #getRuntimeConfig() {
    return this.runtimeConfigProvider();
  }
}

function attachResponseMeta(response, startedAt, endedAt) {
  if (!response || typeof response !== 'object') {
    return response;
  }

  response._vbMeta = {
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
  };
  return response;
}

export function extractOutputText(response) {
  if (
    typeof response.output_text === 'string' &&
    response.output_text.length > 0
  ) {
    return response.output_text;
  }

  const parts = [];
  for (const item of response.output ?? []) {
    if (!item || item.type !== 'message') {
      continue;
    }

    for (const content of item.content ?? []) {
      if (typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }

  return parts.join('\n').trim();
}

export function extractReasoningSummary(response) {
  const summaries = [];
  for (const item of response?.output ?? []) {
    if (!item || item.type !== 'reasoning') {
      continue;
    }

    if (Array.isArray(item.summary)) {
      for (const entry of item.summary) {
        if (typeof entry?.text === 'string' && entry.text.trim()) {
          summaries.push(entry.text.trim());
        } else if (typeof entry === 'string' && entry.trim()) {
          summaries.push(entry.trim());
        }
      }
    }

    if (typeof item.text === 'string' && item.text.trim()) {
      summaries.push(item.text.trim());
    }
  }

  return summaries.join('\n\n').trim();
}

function buildMessage(payload, repairContext) {
  if (!repairContext) {
    return userMessage(JSON.stringify(payload));
  }

  return userMessage(
    [
      `The previous ${repairContext.task} output was invalid. Repair it.`,
      repairContext.hint,
      `Validation errors:\n${repairContext.errorMessage}`,
      `Previous invalid output: ${repairContext.previousOutput}`,
      `Original request JSON: ${JSON.stringify(payload)}`,
    ].join('\n'),
  );
}

function developerMessage(text) {
  return {
    type: 'message',
    role: 'developer',
    content: [
      {
        type: 'input_text',
        text,
      },
    ],
  };
}

function userMessage(text) {
  return {
    type: 'message',
    role: 'user',
    content: [
      {
        type: 'input_text',
        text,
      },
    ],
  };
}

function assistantMessage(text) {
  return {
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'output_text',
        text,
      },
    ],
  };
}

function pruneHistory(history) {
  const maxMessages = 18;
  const immutablePrefix = 1;
  if (history.length <= maxMessages) {
    return;
  }

  const tail = history.slice(-(maxMessages - immutablePrefix));
  history.splice(immutablePrefix, history.length - immutablePrefix, ...tail);
}

function isConversationUnsupported(error) {
  return (
    error?.code === 'unsupported_parameter' && error?.param === 'conversation'
  );
}

function createNullLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return this;
    },
  };
}

function buildRenderPageInstructions(runtimeConfig) {
  if (!runtimeConfig.renderer.scaffolding.trim()) {
    return runtimeConfig.renderer.pagePrompt;
  }

  return [
    runtimeConfig.renderer.pagePrompt,
    'Renderer scaffolding guidance:',
    runtimeConfig.renderer.scaffolding,
  ].join('\n\n');
}

function buildReasoningConfig(reasoningEffort) {
  if (!reasoningEffort || reasoningEffort === 'none') {
    return {};
  }

  return {
    reasoning: {
      effort: reasoningEffort,
      summary: 'auto',
    },
  };
}

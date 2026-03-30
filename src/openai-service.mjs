import OpenAI from 'openai';

import { serializeError, summarizeResponseUsage } from './logger.mjs';
import { buildSystemPrompt, HTTP_ENVELOPE_SCHEMA } from './prompt.mjs';

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
    this.systemPrompt = config.systemPrompt ?? buildSystemPrompt();
  }

  async createSession(seedPhrase) {
    const history = [
      developerMessage(this.systemPrompt),
      userMessage(`Session seed phrase: ${seedPhrase}`),
    ];
    const startedAt = Date.now();
    this.logger.info('session.bootstrap.start', {
      seedBytes: Buffer.byteLength(seedPhrase, 'utf8'),
    });

    try {
      const conversation = await this.client.conversations.create({
        items: history,
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

  async generateResponse(session, requestEnvelope) {
    return this.#generate(session, requestEnvelope, null);
  }

  async #generate(session, requestEnvelope, repairContext) {
    const startedAt = Date.now();
    const message = repairContext
      ? userMessage(
          [
            'The previous response failed the HTTP lint harness. Repair it.',
            'Return a full replacement JSON envelope that fixes every issue.',
            'If you are returning a redirect (3xx with a Location header), an empty body is allowed and Content-Type may be omitted.',
            `Validation errors:\n${repairContext.errorMessage}`,
            `Previous invalid output: ${repairContext.previousOutput}`,
            `Original request JSON: ${JSON.stringify(requestEnvelope)}`,
          ].join('\n'),
        )
      : userMessage(JSON.stringify(requestEnvelope));

    if (session.mode !== 'local' && session.conversationId) {
      try {
        this.logger.debug('openai.response.start', {
          mode: session.mode,
          conversationId: session.conversationId,
          repair: Boolean(repairContext),
        });
        const response = await this.client.responses.create(
          this.#buildRequest({
            session,
            input: [message],
            useConversation: true,
          }),
        );
        this.#appendHistory(session, message, response);
        this.logger.info('openai.response.success', {
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
          this.logger.error('openai.response.failed', {
            mode: session.mode,
            conversationId: session.conversationId,
            repair: Boolean(repairContext),
            durationMs: Date.now() - startedAt,
            error: serializeError(error),
          });
          throw error;
        }

        this.logger.warn('openai.response.fallback_local_history', {
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

    this.logger.debug('openai.response.start', {
      mode: 'local',
      repair: Boolean(repairContext),
      historyLength: session.history.length,
    });
    const response = await this.client.responses.create(
      this.#buildRequest({
        session,
        input: [...session.history, message],
        useConversation: false,
      }),
    );
    this.#appendHistory(session, message, response);
    this.logger.info('openai.response.success', {
      mode: 'local',
      repair: Boolean(repairContext),
      durationMs: Date.now() - startedAt,
      historyLength: session.history.length,
      ...summarizeResponseUsage(response),
    });
    return response;
  }

  #buildRequest({ session, input, useConversation }) {
    return {
      model: this.config.model,
      instructions: this.systemPrompt,
      ...(this.config.reasoningEffort && this.config.reasoningEffort !== 'none'
        ? {
            reasoning: {
              effort: this.config.reasoningEffort,
            },
          }
        : {}),
      ...(useConversation
        ? { conversation: session.conversationId }
        : { store: false }),
      input,
      max_output_tokens: this.config.maxOutputTokens,
      truncation: 'auto',
      text: {
        format: {
          type: 'json_schema',
          name: 'http_response_envelope',
          strict: true,
          schema: HTTP_ENVELOPE_SCHEMA,
        },
      },
    };
  }

  async repairResponse(session, requestEnvelope, previousOutput, errorMessage) {
    return this.#generate(session, requestEnvelope, {
      previousOutput,
      errorMessage,
    });
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
  const immutablePrefix = 2;
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

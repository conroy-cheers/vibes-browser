import crypto from 'node:crypto';
import http from 'node:http';
import querystring from 'node:querystring';
import { URL } from 'node:url';

import {
  serializeError,
  summarizeEnvelope,
  summarizeRequest,
} from './logger.mjs';
import { extractOutputText } from './openai-service.mjs';
import { buildBootstrapPage, buildErrorPage } from './prompt.mjs';
import {
  formatValidationIssues,
  headersToObject,
  NO_CACHE_HEADERS,
  parseAndNormalizeEnvelope,
} from './validation.mjs';

const SESSION_COOKIE = 'vibe_session';
let requestSequence = 0;

export function createApp(config, dependencies) {
  const sessions = new Map();
  const openaiService = dependencies.openaiService;
  const now = dependencies.now ?? (() => Date.now());
  const logger = dependencies.logger ?? createNullLogger();

  const server = http.createServer(async (req, res) => {
    const requestId = String(++requestSequence);
    const startedAt = now();
    const requestLogger = logger.child({ requestId });
    let requestContext = {
      route: 'unresolved',
      sessionId: null,
    };

    res.once('finish', () => {
      requestLogger.info('http.response.complete', {
        ...requestContext,
        method: req.method,
        path: req.url,
        status: res.statusCode,
        durationMs: now() - startedAt,
      });
    });

    try {
      expireSessions();
      await routeRequest(req, res, requestLogger, (context) => {
        requestContext = {
          ...requestContext,
          ...context,
        };
      });
    } catch (error) {
      requestLogger.error('http.request.failed', {
        ...requestContext,
        error: serializeError(error),
      });
      writeHtml(
        res,
        500,
        buildErrorPage(
          'Internal Server Error',
          'The local server failed to handle the request.',
        ),
      );
    }
  });

  function expireSessions() {
    const cutoff = now() - config.sessionTtlMinutes * 60 * 1000;
    for (const [sessionId, session] of sessions.entries()) {
      if (session.lastSeenAt < cutoff) {
        sessions.delete(sessionId);
        logger.info('session.expired', {
          sessionId,
          mode: session.mode,
        });
      }
    }
  }

  async function routeRequest(req, res, requestLogger, updateContext) {
    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? `${config.host}:${config.port}`}`,
    );
    const cookieHeader = req.headers.cookie ?? '';
    const sessionId = parseCookies(cookieHeader)[SESSION_COOKIE];
    const session = sessionId ? sessions.get(sessionId) : null;

    updateContext({
      sessionId: session?.id ?? sessionId ?? null,
    });

    if (session) {
      session.lastSeenAt = now();
    }

    requestLogger.info('http.request.start', {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      hasSession: Boolean(session),
      sessionMode: session?.mode,
    });

    if (url.pathname === '/_healthz') {
      updateContext({ route: 'healthz' });
      writeResponse(
        res,
        200,
        { 'content-type': 'text/plain; charset=utf-8', ...NO_CACHE_HEADERS },
        'ok',
      );
      return;
    }

    if (url.pathname === '/favicon.ico') {
      updateContext({ route: 'favicon' });
      writeResponse(
        res,
        204,
        {
          ...NO_CACHE_HEADERS,
          'content-length': '0',
        },
        '',
      );
      return;
    }

    if (url.pathname === '/_session/reset' && req.method === 'POST') {
      updateContext({ route: 'session_reset' });
      if (sessionId) {
        sessions.delete(sessionId);
        requestLogger.info('session.reset', {
          sessionId,
        });
      }
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
      );
      redirect(res, '/');
      return;
    }

    if (url.pathname === '/_session/start' && req.method === 'POST') {
      updateContext({ route: 'session_start' });
      const form = querystring.parse(
        await readBody(req, config.requestBodyLimitBytes),
      );
      const phrase = String(form.phrase ?? '').trim();
      if (!phrase) {
        requestLogger.warn('session.start.invalid', {
          reason: 'missing_phrase',
        });
        writeHtml(res, 400, buildBootstrapPage('Seed phrase is required.'));
        return;
      }

      const created = await openaiService.createSession(phrase);
      const newSessionId = crypto.randomUUID();
      sessions.set(newSessionId, {
        id: newSessionId,
        conversationId: created.conversationId,
        mode: created.mode,
        history: created.history,
        seedPhrase: phrase,
        createdAt: now(),
        lastSeenAt: now(),
        queue: Promise.resolve(),
      });

      updateContext({
        sessionId: newSessionId,
      });
      requestLogger.info('session.start.created', {
        sessionId: newSessionId,
        mode: created.mode,
        conversationId: created.conversationId,
      });
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${newSessionId}; Path=/; HttpOnly; SameSite=Lax`,
      );
      redirect(res, '/');
      return;
    }

    if (!session) {
      if (
        url.pathname === '/' &&
        (req.method === 'GET' || req.method === 'HEAD')
      ) {
        updateContext({ route: 'bootstrap' });
        if (req.method === 'HEAD') {
          writeResponse(
            res,
            200,
            { 'content-type': 'text/html; charset=utf-8', ...NO_CACHE_HEADERS },
            '',
          );
          return;
        }
        writeHtml(res, 200, buildBootstrapPage());
        return;
      }

      updateContext({ route: 'no_session' });
      requestLogger.warn('http.request.no_session', {
        path: url.pathname,
        method: req.method,
      });
      writeHtml(
        res,
        404,
        buildErrorPage(
          'No Active Session',
          'Start a session from the home page first.',
        ),
      );
      return;
    }

    updateContext({
      route: 'model_request',
      sessionId: session.id,
    });

    const requestInfo = await buildRequestEnvelope(
      req,
      url,
      config.requestBodyLimitBytes,
    );
    requestLogger.debug(
      'http.request.forwarded_to_model',
      summarizeRequest(requestInfo),
    );

    const envelope = await runExclusive(session, async () => {
      const first = await openaiService.generateResponse(session, requestInfo);
      return materializeModelResponse(
        session,
        openaiService,
        requestInfo,
        first,
        config.responseBudgets,
        config.maxRepairAttempts,
        requestLogger,
      );
    });

    const headers = headersToObject(envelope.headers);
    const responseBody = req.method === 'HEAD' ? '' : envelope.body;
    headers['content-length'] = String(
      Buffer.byteLength(envelope.body, 'utf8'),
    );
    requestLogger.info(
      'http.request.model_response_ready',
      summarizeEnvelope(envelope),
    );
    writeResponse(res, envelope.status, headers, responseBody);
  }

  return {
    server,
    sessions,
    listen() {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () =>
          resolve(server.address()),
        );
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function materializeModelResponse(
  session,
  openaiService,
  requestInfo,
  rawResponse,
  budgets,
  maxRepairAttempts,
  logger,
) {
  let output = extractText(rawResponse);

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
    try {
      const envelope = parseAndNormalizeEnvelope(output, budgets);
      if (attempt > 0) {
        logger.info('model.response.repair_succeeded', {
          attempt,
          maxAttempts: maxRepairAttempts,
          ...summarizeEnvelope(envelope),
        });
      }
      return envelope;
    } catch (error) {
      const issues = formatValidationIssues(error);
      if (attempt >= maxRepairAttempts) {
        logger.error('model.response.repair_failed', {
          attempt,
          maxAttempts: maxRepairAttempts,
          issues,
          error: serializeError(error),
          rawOutputPreview: output,
        });
        throw error;
      }

      logger.warn('model.response.invalid_attempt', {
        attempt,
        maxAttempts: maxRepairAttempts,
        mode: session.mode,
        issues,
        error: serializeError(error),
        rawOutputPreview: output,
      });

      const repaired = await openaiService.repairResponse(
        session,
        requestInfo,
        output,
        issues,
      );
      output = extractText(repaired);
    }
  }
}

function extractText(response) {
  return extractOutputText(response);
}

async function buildRequestEnvelope(req, url, limitBytes) {
  const bodyText =
    req.method === 'GET' || req.method === 'HEAD'
      ? ''
      : await readBody(req, limitBytes);
  const selectedHeaders = [
    'accept',
    'content-type',
    'origin',
    'referer',
  ].flatMap((name) =>
    req.headers[name] ? [{ name, value: String(req.headers[name]) }] : [],
  );

  return {
    method: req.method ?? 'GET',
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: selectedHeaders,
    bodyText,
  };
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const entry of cookieHeader.split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator < 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

function runExclusive(session, task) {
  const run = session.queue.then(task, task);
  session.queue = run.catch(() => {});
  return run;
}

async function readBody(req, limitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new Error('Request body exceeded the configured limit.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function redirect(res, location) {
  writeResponse(
    res,
    303,
    {
      location,
      'content-type': 'text/plain; charset=utf-8',
      ...NO_CACHE_HEADERS,
    },
    'See Other',
  );
}

function writeHtml(res, status, body) {
  writeResponse(
    res,
    status,
    {
      'content-type': 'text/html; charset=utf-8',
      ...NO_CACHE_HEADERS,
      'content-length': String(Buffer.byteLength(body, 'utf8')),
    },
    body,
  );
}

function writeResponse(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
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

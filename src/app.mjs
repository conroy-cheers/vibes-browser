import crypto from 'node:crypto';
import http from 'node:http';
import querystring from 'node:querystring';
import { URL } from 'node:url';

import { parseRenderedPageResult, parseSessionDecision } from './contracts.mjs';
import {
  serializeError,
  summarizeRequest,
  summarizeResponseUsage,
} from './logger.mjs';
import {
  extractOutputText,
  extractReasoningSummary,
} from './openai-service.mjs';
import { buildBootstrapPage, buildErrorPage } from './prompt.mjs';
import { createRuntimeState } from './runtime-state.mjs';
import {
  createValidationError,
  finalizeRenderedHtml,
  formatValidationIssues,
  NO_CACHE_HEADERS,
} from './validation.mjs';
const SESSION_COOKIE = 'vibe_session';
const PAGE_TOKEN_FIELD = '__vb_page';
let requestSequence = 0;
let interactionSequence = 0;

export function createApp(config, dependencies = {}) {
  const runtimeState =
    dependencies.runtimeState ?? createRuntimeState({ config });
  const sessions = runtimeState.sessions;
  const openaiService = dependencies.openaiService;
  const now = dependencies.now ?? (() => Date.now());
  const logger = dependencies.logger ?? createNullLogger();
  const pageTokenSecret =
    dependencies.pageTokenSecret ?? crypto.randomBytes(32).toString('hex');

  const server = http.createServer(async (req, res) => {
    const requestId = String(++requestSequence);
    const startedAt = now();
    const requestLogger = logger.child({ requestId });
    let requestContext = {
      route: 'unresolved',
      sessionId: null,
      interactionId: null,
      trigger: null,
      path: req.url ?? '/',
      method: req.method ?? 'GET',
      configVersion: runtimeState.getActiveRuntimeConfig().version,
    };

    res.once('finish', () => {
      const endedAt = now();
      const durationMs = endedAt - startedAt;
      requestLogger.info('http.response.complete', {
        ...requestContext,
        method: requestContext.method,
        path: requestContext.path,
        status: res.statusCode,
        durationMs,
      });
      runtimeState.recordEvent({
        type: 'browser.response',
        actor: 'browser',
        requestId,
        sessionId: requestContext.sessionId,
        interactionId: requestContext.interactionId,
        trigger: requestContext.trigger,
        summary: `${requestContext.method} ${requestContext.path} -> ${res.statusCode}`,
        route: requestContext.route,
        status: res.statusCode,
        startedAt,
        endedAt,
        durationMs,
        configVersion: requestContext.configVersion,
      });
    });

    try {
      expireSessions();
      await routeRequest(req, res, requestLogger, requestId, (context) => {
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
      runtimeState.recordEvent({
        type: 'browser.error',
        actor: 'server',
        requestId,
        sessionId: requestContext.sessionId,
        interactionId: requestContext.interactionId,
        trigger: requestContext.trigger,
        summary: `Request failed for ${requestContext.method} ${requestContext.path}`,
        route: requestContext.route,
        error: serializeError(error),
        configVersion: requestContext.configVersion,
      });
      writeHtml(
        res,
        500,
        buildErrorPage(
          'Internal Server Error',
          'The local server failed to handle the request.',
        ),
        req.method,
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
        runtimeState.recordEvent({
          type: 'session.expired',
          actor: 'server',
          sessionId,
          summary: `Expired session ${sessionId}.`,
        });
      }
    }
  }

  async function routeRequest(
    req,
    res,
    requestLogger,
    requestId,
    updateContext,
  ) {
    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? `${config.host}:${config.port}`}`,
    );
    const cookieHeader = req.headers.cookie ?? '';
    const sessionId = parseCookies(cookieHeader)[SESSION_COOKIE];
    const session = sessionId ? sessions.get(sessionId) : null;
    const requestRuntimeConfig = runtimeState.getActiveRuntimeConfig();

    updateContext({
      sessionId: session?.id ?? sessionId ?? null,
      path: `${url.pathname}${url.search}`,
      method: req.method ?? 'GET',
      configVersion: requestRuntimeConfig.version,
    });

    if (session) {
      session.lastSeenAt = now();
    }

    const startFields = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      hasSession: Boolean(session),
      sessionMode: session?.mode,
    };
    requestLogger.info('http.request.start', startFields);
    runtimeState.recordEvent({
      type: 'browser.request',
      actor: 'browser',
      requestId,
      sessionId: session?.id ?? sessionId ?? null,
      summary: `${req.method ?? 'GET'} ${url.pathname}`,
      payload: startFields,
      configVersion: requestRuntimeConfig.version,
    });

    if (url.pathname === '/_healthz') {
      updateContext({ route: 'healthz' });
      writeResponse(
        res,
        200,
        { 'content-type': 'text/plain; charset=utf-8', ...NO_CACHE_HEADERS },
        'ok',
        req.method,
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
        req.method,
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
        runtimeState.recordEvent({
          type: 'session.reset',
          actor: 'server',
          requestId,
          sessionId,
          summary: `Reset session ${sessionId}.`,
          configVersion: requestRuntimeConfig.version,
        });
      }
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
      );
      redirect(res, '/', req.method);
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
        runtimeState.recordEvent({
          type: 'session.start.invalid',
          actor: 'server',
          requestId,
          sessionId: null,
          summary: 'Rejected session start with a missing seed phrase.',
          payload: { reason: 'missing_phrase' },
          configVersion: requestRuntimeConfig.version,
        });
        writeHtml(
          res,
          400,
          buildBootstrapPage('Seed phrase is required.'),
          req.method,
        );
        return;
      }

      const created = await openaiService.createSession(
        phrase,
        requestRuntimeConfig,
      );
      const newSessionId = crypto.randomUUID();
      sessions.set(newSessionId, {
        id: newSessionId,
        conversationId: created.conversationId,
        mode: created.mode,
        history: created.history,
        seedPhrase: phrase,
        siteStyleGuide: null,
        createdAt: now(),
        lastSeenAt: now(),
        queue: Promise.resolve(),
        pendingRedirect: null,
        pathState: new Map(),
        pageInstances: new Map(),
      });

      updateContext({
        sessionId: newSessionId,
      });
      requestLogger.info('session.start.created', {
        sessionId: newSessionId,
        mode: created.mode,
        conversationId: created.conversationId,
      });
      runtimeState.recordEvent({
        type: 'session.start.created',
        actor: 'server',
        requestId,
        sessionId: newSessionId,
        summary: `Created session ${newSessionId}.`,
        payload: {
          phrase,
          mode: created.mode,
          conversationId: created.conversationId,
        },
        configVersion: requestRuntimeConfig.version,
      });
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${newSessionId}; Path=/; HttpOnly; SameSite=Lax`,
      );
      redirect(res, '/', req.method);
      return;
    }

    if (!session) {
      if (
        url.pathname === '/' &&
        (req.method === 'GET' || req.method === 'HEAD')
      ) {
        updateContext({ route: 'bootstrap' });
        writeHtml(res, 200, buildBootstrapPage(), req.method);
        return;
      }

      updateContext({ route: 'no_session' });
      requestLogger.warn('http.request.no_session', {
        path: url.pathname,
        method: req.method,
      });
      runtimeState.recordEvent({
        type: 'browser.no_session',
        actor: 'server',
        requestId,
        sessionId: null,
        summary: `Rejected ${req.method ?? 'GET'} ${url.pathname} without an active session.`,
        payload: {
          method: req.method,
          path: url.pathname,
        },
        configVersion: requestRuntimeConfig.version,
      });
      writeHtml(
        res,
        404,
        buildErrorPage(
          'No Active Session',
          'Start a session from the home page first.',
        ),
        req.method,
      );
      return;
    }

    const normalizeStartedAt = now();
    const requestInfo = await buildRequestEnvelope(
      req,
      url,
      config.requestBodyLimitBytes,
    );
    const normalizeEndedAt = now();
    const interaction = beginInteractionForRequest(
      session,
      requestInfo,
      requestId,
      normalizeStartedAt,
      normalizeEndedAt,
    );
    runtimeState.recordEvent({
      type: 'browser.request.normalized',
      actor: 'browser',
      requestId,
      sessionId: session.id,
      interactionId: interaction.id,
      trigger: interaction.trigger,
      summary: `Normalized ${requestInfo.method} ${requestInfo.path}`,
      startedAt: normalizeStartedAt,
      endedAt: normalizeEndedAt,
      durationMs: normalizeEndedAt - normalizeStartedAt,
      payload: {
        ...requestInfo,
        trigger: interaction.trigger,
      },
      configVersion: requestRuntimeConfig.version,
    });

    updateContext({
      route: 'session_request',
      sessionId: session.id,
      interactionId: interaction.id,
      trigger: interaction.trigger,
    });

    requestLogger.debug(
      'http.request.forwarded_to_session',
      summarizeRequest(requestInfo),
    );

    const envelope = await runExclusive(session, async () => {
      const submissionContext = resolveSubmissionContext(
        session,
        requestInfo,
        pageTokenSecret,
      );
      if (submissionContext.error) {
        requestLogger.warn('page.binding.invalid', submissionContext.error);
        runtimeState.recordEvent({
          type: 'browser.form_binding.invalid',
          actor: 'server',
          requestId,
          sessionId: session.id,
          interactionId: interaction.id,
          trigger: interaction.trigger,
          summary: `Rejected stale or invalid form submission for ${requestInfo.path}.`,
          payload: submissionContext.error,
          configVersion: requestRuntimeConfig.version,
        });
        return htmlEnvelope(
          409,
          buildErrorPage(
            'Stale Page',
            'This form came from an older page instance. Reload the page and try again.',
          ),
        );
      }

      const plannerRequest = buildPlannerRequest(
        session,
        requestInfo,
        submissionContext.boundPage,
      );
      runtimeState.recordEvent({
        type: 'session.plan.input',
        actor: 'session_agent',
        requestId,
        sessionId: session.id,
        interactionId: interaction.id,
        trigger: interaction.trigger,
        summary: `Session planner input for ${requestInfo.method} ${requestInfo.path}`,
        payload: plannerRequest,
        configVersion: requestRuntimeConfig.version,
      });

      const initialPlan = await openaiService.planSessionResponse(
        session,
        plannerRequest,
        requestRuntimeConfig,
      );
      const decision = await materializeStructuredResponse({
        initialResponse: initialPlan,
        parseOutput: parseSessionDecision,
        repair: (previousOutput, issues) =>
          openaiService.repairSessionPlan(
            session,
            plannerRequest,
            previousOutput,
            issues,
            requestRuntimeConfig,
          ),
        logger: requestLogger,
        eventBase: 'session.plan',
        maxRepairAttempts: config.maxRepairAttempts,
        runtimeState,
        requestId,
        sessionId: session.id,
        interactionId: interaction.id,
        trigger: interaction.trigger,
        actor: 'session_agent',
        summaryLabel: 'Session planner',
        configVersion: requestRuntimeConfig.version,
      });

      return await materializeDecision({
        session,
        decision,
        requestInfo,
        config,
        openaiService,
        requestLogger,
        now,
        pageTokenSecret,
        runtimeState,
        requestId,
        interactionId: interaction.id,
        trigger: interaction.trigger,
        runtimeConfig: requestRuntimeConfig,
      });
    });

    writeEnvelope(res, envelope, req.method);
  }

  return {
    server,
    sessions,
    runtimeState,
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

async function materializeDecision({
  session,
  decision,
  requestInfo,
  config,
  openaiService,
  requestLogger,
  now,
  pageTokenSecret,
  runtimeState,
  requestId,
  interactionId,
  trigger,
  runtimeConfig,
}) {
  runtimeState.recordEvent({
    type: 'session.plan.parsed',
    actor: 'session_agent',
    requestId,
    sessionId: session.id,
    interactionId,
    trigger,
    summary: `Session planner chose ${decision.kind} for ${requestInfo.path}`,
    payload: decision,
    configVersion: runtimeConfig.version,
  });

  if (decision.kind === 'redirect') {
    rememberPendingRedirect(session, {
      interactionId,
      location: decision.location,
      createdAt: now(),
    });
    return textEnvelope(303, 'See Other', {
      location: decision.location,
      'content-type': 'text/plain; charset=utf-8',
    });
  }

  if (decision.kind === 'not_found') {
    return htmlEnvelope(404, buildErrorPage(decision.title, decision.message));
  }

  if (decision.kind === 'error_page') {
    return htmlEnvelope(500, buildErrorPage(decision.title, decision.message));
  }

  session.siteStyleGuide = decision.siteStyleGuide;

  const pageInstanceId = crypto.randomUUID();
  const formTokens = Object.fromEntries(
    decision.forms.map((form) => [
      form.formId,
      signPageToken(pageTokenSecret, {
        sessionId: session.id,
        pageInstanceId,
        formId: form.formId,
        sourcePath: requestInfo.path,
        issuedAt: now(),
      }),
    ]),
  );

  const renderRequest = {
    seed_phrase: session.seedPhrase,
    path: requestInfo.path,
    page_type: decision.pageType,
    page_summary: decision.pageSummary,
    path_state_summary: decision.pathStateSummary,
    title: decision.title,
    design_brief: decision.designBrief,
    links: decision.links,
    forms: decision.forms,
    interactive_requirement: {
      required: decision.interactiveRequirement.required,
      reason: decision.interactiveRequirement.reason,
      behaviors: decision.interactiveRequirement.behaviors,
    },
    site_style_guide: serializeSiteStyleGuide(decision.siteStyleGuide),
    renderer_scaffolding: runtimeConfig.renderer.scaffolding,
  };
  runtimeState.recordEvent({
    type: 'renderer.page.input',
    actor: 'renderer_page',
    requestId,
    sessionId: session.id,
    interactionId,
    trigger,
    summary: `Renderer page input for ${requestInfo.path}`,
    payload: renderRequest,
    configVersion: runtimeConfig.version,
  });

  const initialRenderedPage = await openaiService.renderPage(
    renderRequest,
    runtimeConfig,
  );
  const renderedPage = await materializeStructuredResponse({
    initialResponse: initialRenderedPage,
    parseOutput: (rawOutput) => {
      const finalizeStartedAt = now();
      const html = finalizeRenderedHtml(parseRenderedPageResult(rawOutput), {
        title: decision.title,
        siteStyleGuide: decision.siteStyleGuide,
        forms: decision.forms,
        formTokens,
        requireInlineScripts: decision.interactiveRequirement.required,
      });
      const finalizeEndedAt = now();
      return {
        html,
        hasJavaScript: /<script\b/iu.test(html),
        finalizeDurationMs: finalizeEndedAt - finalizeStartedAt,
      };
    },
    repair: (previousOutput, issues) =>
      openaiService.repairRenderedPage(
        renderRequest,
        previousOutput,
        issues,
        runtimeConfig,
      ),
    logger: requestLogger,
    eventBase: 'renderer.page',
    maxRepairAttempts: config.maxRepairAttempts,
    runtimeState,
    requestId,
    sessionId: session.id,
    interactionId,
    trigger,
    actor: 'renderer_page',
    summaryLabel: 'Renderer page',
    configVersion: runtimeConfig.version,
  });

  session.pageInstances.set(pageInstanceId, {
    id: pageInstanceId,
    path: requestInfo.path,
    createdAt: now(),
    pageType: decision.pageType,
    pageSummary: decision.pageSummary,
    title: decision.title,
    forms: decision.forms,
    interactiveRequirement: decision.interactiveRequirement,
    siteStyleGuide: decision.siteStyleGuide,
    html: renderedPage.html,
  });
  session.pathState.set(requestInfo.path, {
    pageType: decision.pageType,
    pageSummary: decision.pageSummary,
    pageInstanceId,
    title: decision.title,
    updatedAt: now(),
  });

  requestLogger.info('session.page_instance.created', {
    pageInstanceId,
    path: requestInfo.path,
    pageType: decision.pageType,
    hasJavascript: renderedPage.hasJavaScript,
  });
  runtimeState.recordEvent({
    type: 'renderer.page.final',
    actor: 'server',
    requestId,
    sessionId: session.id,
    interactionId,
    trigger,
    summary: `Created page instance ${pageInstanceId} for ${requestInfo.path}`,
    payload: {
      pageInstanceId,
      path: requestInfo.path,
      pageType: decision.pageType,
      html: renderedPage.html,
      hasJavascript: renderedPage.hasJavaScript,
      finalizeDurationMs: renderedPage.finalizeDurationMs,
    },
    durationMs: renderedPage.finalizeDurationMs,
    configVersion: runtimeConfig.version,
  });

  return htmlEnvelope(200, renderedPage.html);
}

async function materializeStructuredResponse({
  initialResponse,
  parseOutput,
  repair,
  logger,
  eventBase,
  maxRepairAttempts,
  runtimeState,
  requestId,
  sessionId,
  interactionId,
  trigger,
  actor,
  summaryLabel,
  configVersion,
}) {
  let output = extractOutputText(initialResponse);
  let reasoningSummary = extractReasoningSummary(initialResponse);
  const initialMeta = extractResponseMeta(initialResponse);
  runtimeState.recordEvent({
    type: `${eventBase}.output`,
    actor,
    requestId,
    sessionId,
    interactionId,
    trigger,
    summary: `${summaryLabel} output attempt 1`,
    startedAt: initialMeta.startedAt,
    endedAt: initialMeta.endedAt,
    durationMs: initialMeta.durationMs,
    payload: {
      attempt: 0,
      output,
      reasoningSummary,
      response: summarizeResponseUsage(initialResponse),
    },
    configVersion,
  });

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
    try {
      const parsed = parseOutput(output);
      if (attempt > 0) {
        logger.info(`${eventBase}.repair_succeeded`, {
          attempt,
          maxAttempts: maxRepairAttempts,
        });
      }
      runtimeState.recordEvent({
        type: `${eventBase}.parsed`,
        actor,
        requestId,
        sessionId,
        interactionId,
        trigger,
        summary: `${summaryLabel} parsed successfully on attempt ${attempt + 1}`,
        payload: {
          attempt,
          parsed,
          reasoningSummary,
        },
        configVersion,
      });
      return parsed;
    } catch (error) {
      const issues = formatValidationIssues(error);
      if (attempt >= maxRepairAttempts) {
        logger.error(`${eventBase}.repair_failed`, {
          attempt,
          maxAttempts: maxRepairAttempts,
          issues,
          error: serializeError(error),
          rawOutputPreview: output,
        });
        runtimeState.recordEvent({
          type: `${eventBase}.repair_failed`,
          actor,
          requestId,
          sessionId,
          interactionId,
          trigger,
          summary: `${summaryLabel} exhausted repair attempts`,
          payload: {
            attempt,
            issues,
            output,
            error: serializeError(error),
          },
          configVersion,
        });
        throw error;
      }

      logger.warn(`${eventBase}.invalid_attempt`, {
        attempt,
        maxAttempts: maxRepairAttempts,
        issues,
        error: serializeError(error),
        rawOutputPreview: output,
      });
      runtimeState.recordEvent({
        type: `${eventBase}.invalid`,
        actor,
        requestId,
        sessionId,
        interactionId,
        trigger,
        summary: `${summaryLabel} failed validation on attempt ${attempt + 1}`,
        payload: {
          attempt,
          issues,
          output,
          error: serializeError(error),
        },
        configVersion,
      });

      runtimeState.recordEvent({
        type: `${eventBase}.repair_requested`,
        actor,
        requestId,
        sessionId,
        interactionId,
        trigger,
        summary: `${summaryLabel} repair requested`,
        payload: {
          attempt,
          issues,
          previous_output: output,
        },
        configVersion,
      });
      const repaired = await repair(output, issues);
      output = extractOutputText(repaired);
      reasoningSummary = extractReasoningSummary(repaired);
      const repairedMeta = extractResponseMeta(repaired);
      runtimeState.recordEvent({
        type: `${eventBase}.output`,
        actor,
        requestId,
        sessionId,
        interactionId,
        trigger,
        summary: `${summaryLabel} output attempt ${attempt + 2}`,
        startedAt: repairedMeta.startedAt,
        endedAt: repairedMeta.endedAt,
        durationMs: repairedMeta.durationMs,
        payload: {
          attempt: attempt + 1,
          output,
          reasoningSummary,
          response: summarizeResponseUsage(repaired),
        },
        configVersion,
      });
    }
  }
}

function buildPlannerRequest(session, requestInfo, boundPage) {
  return {
    seed_phrase: session.seedPhrase,
    request: {
      method: requestInfo.method,
      path: requestInfo.path,
      query: requestInfo.query,
      headers: requestInfo.headers,
      body_text: requestInfo.bodyText,
      form_data: requestInfo.formData,
    },
    latest_path_state: session.pathState.get(requestInfo.path) ?? null,
    site_style_guide: session.siteStyleGuide
      ? serializeSiteStyleGuide(session.siteStyleGuide)
      : null,
    source_page: boundPage
      ? {
          page_instance_id: boundPage.pageInstance.id,
          path: boundPage.pageInstance.path,
          page_type: boundPage.pageInstance.pageType,
          page_summary: boundPage.pageInstance.pageSummary,
          title: boundPage.pageInstance.title,
          form: {
            form_id: boundPage.form.formId,
            method: boundPage.form.method,
            action: boundPage.form.action,
            purpose: boundPage.form.purpose,
            fields: boundPage.form.fields,
          },
          submission_fields: boundPage.submissionFields,
        }
      : null,
  };
}

function resolveSubmissionContext(session, requestInfo, pageTokenSecret) {
  const bindingRequired = requestInfo.method === 'POST';
  if (!requestInfo.pageToken) {
    if (bindingRequired) {
      return {
        error: {
          reason: 'missing_page_token',
          path: requestInfo.path,
          method: requestInfo.method,
        },
      };
    }

    return { boundPage: null };
  }

  const verified = verifyPageToken(pageTokenSecret, requestInfo.pageToken);
  if (!verified.valid) {
    return {
      error: {
        reason: verified.reason,
        path: requestInfo.path,
        method: requestInfo.method,
      },
    };
  }

  if (verified.payload.sessionId !== session.id) {
    return {
      error: {
        reason: 'session_mismatch',
        path: requestInfo.path,
        method: requestInfo.method,
      },
    };
  }

  const pageInstance = session.pageInstances.get(
    verified.payload.pageInstanceId,
  );
  if (!pageInstance) {
    return {
      error: {
        reason: 'unknown_page_instance',
        pageInstanceId: verified.payload.pageInstanceId,
      },
    };
  }

  const form = pageInstance.forms.find(
    (entry) => entry.formId === verified.payload.formId,
  );
  if (!form) {
    return {
      error: {
        reason: 'unknown_form',
        formId: verified.payload.formId,
      },
    };
  }

  if (form.method !== requestInfo.method) {
    return {
      error: {
        reason: 'method_mismatch',
        formId: form.formId,
      },
    };
  }

  if (form.action !== requestInfo.path) {
    return {
      error: {
        reason: 'action_mismatch',
        expected: form.action,
        received: requestInfo.path,
      },
    };
  }

  const submissionFields =
    requestInfo.method === 'GET'
      ? requestInfo.query
      : (requestInfo.formData ?? {});

  return {
    boundPage: {
      pageInstance,
      form,
      submissionFields,
    },
  };
}

async function buildRequestEnvelope(req, url, limitBytes) {
  const method = req.method ?? 'GET';
  const bodyText =
    method === 'GET' || method === 'HEAD'
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

  const query = normalizeStringEntries(
    Object.fromEntries(url.searchParams.entries()),
  );
  const formData = parseFormBody(req.headers['content-type'], bodyText);
  const pageToken =
    formData?.[PAGE_TOKEN_FIELD] ?? query[PAGE_TOKEN_FIELD] ?? null;

  if (pageToken) {
    delete query[PAGE_TOKEN_FIELD];
    if (formData) {
      delete formData[PAGE_TOKEN_FIELD];
    }
  }

  return {
    method,
    path: url.pathname,
    query,
    headers: selectedHeaders,
    bodyText: formData ? querystring.stringify(formData) : bodyText,
    formData,
    pageToken,
  };
}

function parseFormBody(contentTypeHeader, bodyText) {
  if (
    !contentTypeHeader ||
    !String(contentTypeHeader).includes('application/x-www-form-urlencoded')
  ) {
    return null;
  }

  return normalizeStringEntries(querystring.parse(bodyText));
}

function serializeSiteStyleGuide(styleGuide) {
  return {
    theme_name: styleGuide.themeName,
    visual_summary: styleGuide.visualSummary,
    palette: {
      page_bg: styleGuide.palette.pageBg,
      panel_bg: styleGuide.palette.panelBg,
      panel_alt_bg: styleGuide.palette.panelAltBg,
      text: styleGuide.palette.text,
      muted_text: styleGuide.palette.mutedText,
      accent: styleGuide.palette.accent,
      accent_alt: styleGuide.palette.accentAlt,
      border: styleGuide.palette.border,
    },
    typography: {
      body_stack: styleGuide.typography.bodyStack,
      display_stack: styleGuide.typography.displayStack,
      heading_treatment: styleGuide.typography.headingTreatment,
      density: styleGuide.typography.density,
    },
    components: {
      nav_style: styleGuide.components.navStyle,
      button_style: styleGuide.components.buttonStyle,
      input_style: styleGuide.components.inputStyle,
      card_style: styleGuide.components.cardStyle,
      table_style: styleGuide.components.tableStyle,
    },
    chrome: {
      site_title: styleGuide.chrome.siteTitle,
      tagline: styleGuide.chrome.tagline,
      footer_tone: styleGuide.chrome.footerTone,
    },
    motifs: styleGuide.motifs,
  };
}

function normalizeStringEntries(entries) {
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key,
      Array.isArray(value) ? String(value.at(-1) ?? '') : String(value ?? ''),
    ]),
  );
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

function beginInteractionForRequest(
  session,
  requestInfo,
  requestId,
  startedAt,
  normalizedAt,
) {
  const requestPath = buildPathWithQuery(requestInfo.path, requestInfo.query);
  const pendingRedirect = session.pendingRedirect;
  if (
    pendingRedirect &&
    requestInfo.method === 'GET' &&
    pendingRedirect.location === requestPath
  ) {
    session.pendingRedirect = null;
    return {
      id: pendingRedirect.interactionId,
      trigger: 'redirect_follow',
      requestId,
      startedAt,
      normalizedAt,
    };
  }

  if (pendingRedirect) {
    session.pendingRedirect = null;
  }

  return {
    id: nextInteractionId(),
    trigger: inferInteractionTrigger(requestInfo),
    requestId,
    startedAt,
    normalizedAt,
  };
}

function rememberPendingRedirect(session, redirectInfo) {
  session.pendingRedirect = redirectInfo;
}

function nextInteractionId() {
  interactionSequence += 1;
  return `interaction-${interactionSequence}`;
}

function inferInteractionTrigger(requestInfo) {
  if (requestInfo.method === 'POST') {
    return requestInfo.path === '/_session/start'
      ? 'seed_submit'
      : 'form_submit';
  }

  if (requestInfo.method === 'GET') {
    const referer = getSelectedHeader(requestInfo.headers, 'referer');
    if (referer) {
      return 'link_click';
    }
    return requestInfo.path === '/' ? 'direct_visit' : 'reload';
  }

  return 'direct_visit';
}

function getSelectedHeader(headers, name) {
  const target = String(name).toLowerCase();
  return (
    headers?.find((entry) => String(entry?.name).toLowerCase() === target)
      ?.value ?? ''
  );
}

function buildPathWithQuery(pathname, query) {
  const search = new URLSearchParams(query ?? {}).toString();
  return search ? `${pathname}?${search}` : pathname;
}

function extractResponseMeta(response) {
  const meta = response?._vbMeta;
  return {
    startedAt: meta?.startedAt ?? null,
    endedAt: meta?.endedAt ?? null,
    durationMs: meta?.durationMs ?? null,
  };
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

function signPageToken(secret, payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPageToken(secret, token) {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) {
    return { valid: false, reason: 'malformed_token' };
  }

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');

  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return { valid: false, reason: 'invalid_signature' };
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'malformed_payload' };
  }
}

function redirect(res, location, method) {
  writeResponse(
    res,
    303,
    {
      location,
      'content-type': 'text/plain; charset=utf-8',
      ...NO_CACHE_HEADERS,
      'content-length': String(Buffer.byteLength('See Other', 'utf8')),
    },
    'See Other',
    method,
  );
}

function htmlEnvelope(status, body) {
  return {
    status,
    contentType: 'text/html; charset=utf-8',
    body,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  };
}

function textEnvelope(status, body, headers = {}) {
  return {
    status,
    contentType: headers['content-type'] ?? 'text/plain; charset=utf-8',
    body,
    headers,
  };
}

function writeEnvelope(res, envelope, method) {
  const headers = {
    ...NO_CACHE_HEADERS,
    ...envelope.headers,
  };
  headers['content-length'] = String(Buffer.byteLength(envelope.body, 'utf8'));
  writeResponse(res, envelope.status, headers, envelope.body, method);
}

function writeHtml(res, status, body, method) {
  writeEnvelope(res, htmlEnvelope(status, body), method);
}

function writeResponse(res, status, headers, body, method) {
  res.writeHead(status, headers);
  res.end(method === 'HEAD' ? '' : body);
}

function createNullLogger() {
  return {
    base: {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return this;
    },
  };
}

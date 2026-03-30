import { buildDefaultRuntimeConfig } from './prompt.mjs';
import {
  estimateUsageCost,
  formatTokenCount,
  formatUsd,
  formatUsageBadge,
  mergeUsageEstimates,
} from './pricing.mjs';

const DEFAULT_EVENT_LIMIT = 2000;
const GLOBAL_SESSION_ID = '__global__';
const MODEL_OPTIONS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-4.1-nano',
];
const REASONING_EFFORT_OPTIONS = ['none', 'low', 'medium', 'high', 'xhigh'];
const REDACTED = '[redacted]';
const REDACT_KEYS = new Set([
  'authorization',
  'cookie',
  'cookies',
  'apiKey',
  'api_key',
  'OPENAI_API_KEY',
  'pageToken',
  '__vb_page',
  'set-cookie',
  'signature',
]);

export function createRuntimeState(options = {}) {
  const sessions = options.sessions ?? new Map();
  const eventLimit = options.eventLimit ?? DEFAULT_EVENT_LIMIT;
  let nextEventId = 1;
  let version = 1;
  let activeConfig = normalizeRuntimeConfig(
    options.activeConfig ?? buildDefaultRuntimeConfig(options.config),
  );
  let draftConfig = structuredClone(activeConfig);
  const events = [];

  return {
    sessions,
    globalSessionId: GLOBAL_SESSION_ID,
    recordEvent(event) {
      const storedEvent = redactEvent({
        id: String(nextEventId++),
        ts: new Date().toISOString(),
        ...event,
      });
      events.push(storedEvent);
      if (events.length > eventLimit) {
        events.splice(0, events.length - eventLimit);
      }
      return storedEvent;
    },
    getEvents(filter = {}) {
      if (!filter.sessionId || filter.sessionId === GLOBAL_SESSION_ID) {
        return events.slice();
      }

      return events.filter(
        (event) =>
          event.sessionId === filter.sessionId || event.sessionId == null,
      );
    },
    getTranscript(sessionId) {
      return projectTranscript(this.getEvents({ sessionId }));
    },
    getTranscriptSummary(sessionId) {
      return buildTranscriptSummary(this.getTranscript(sessionId));
    },
    getSessionSummaries() {
      const summaries = [
        {
          id: GLOBAL_SESSION_ID,
          label: 'Global',
          mode: 'local',
          seedPhrase: '',
          createdAt: null,
          lastSeenAt: null,
          requestCount: countRequests(events, GLOBAL_SESSION_ID),
        },
      ];

      for (const session of sessions.values()) {
        summaries.push({
          id: session.id,
          label: session.seedPhrase,
          mode: session.mode,
          seedPhrase: session.seedPhrase,
          createdAt: session.createdAt,
          lastSeenAt: session.lastSeenAt,
          requestCount: countRequests(events, session.id),
        });
      }

      return summaries.sort(compareSessionSummaries);
    },
    getRuntimeConfig() {
      return {
        version,
        active: structuredClone(activeConfig),
        draft: structuredClone(draftConfig),
        options: {
          modelOptions: collectModelOptions(activeConfig, draftConfig),
          reasoningEffortOptions: REASONING_EFFORT_OPTIONS,
        },
      };
    },
    getActiveRuntimeConfig() {
      return {
        version,
        ...structuredClone(activeConfig),
      };
    },
    updateDraft(update = {}) {
      draftConfig = normalizeRuntimeConfig(
        mergeRuntimeConfig(draftConfig, update),
      );
      return this.getRuntimeConfig();
    },
    resetDraft() {
      draftConfig = structuredClone(activeConfig);
      return this.getRuntimeConfig();
    },
    applyDraft() {
      activeConfig = structuredClone(draftConfig);
      version += 1;
      return this.getRuntimeConfig();
    },
  };
}

export function createRuntimeConfigSnapshot(runtimeState) {
  return (
    runtimeState?.getActiveRuntimeConfig?.() ?? buildDefaultRuntimeConfig()
  );
}

function normalizeRuntimeConfig(config) {
  return {
    sessionPlanner: {
      model: normalizeModel(config.sessionPlanner?.model),
      reasoningEffort: normalizeReasoningEffort(
        config.sessionPlanner?.reasoningEffort,
      ),
      prompt: normalizeString(config.sessionPlanner?.prompt),
    },
    renderer: {
      model: normalizeModel(config.renderer?.model),
      reasoningEffort: normalizeReasoningEffort(
        config.renderer?.reasoningEffort,
      ),
      pagePrompt: normalizeString(config.renderer?.pagePrompt),
      scaffolding: normalizeString(config.renderer?.scaffolding),
    },
  };
}

function normalizeString(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeModel(value) {
  const model = normalizeString(value);
  return model || MODEL_OPTIONS[0];
}

function normalizeReasoningEffort(value) {
  const effort = normalizeString(value);
  return REASONING_EFFORT_OPTIONS.includes(effort)
    ? effort
    : REASONING_EFFORT_OPTIONS[1];
}

function mergeRuntimeConfig(base, update) {
  return {
    sessionPlanner: {
      ...base.sessionPlanner,
      ...update.sessionPlanner,
    },
    renderer: {
      ...base.renderer,
      ...update.renderer,
    },
  };
}

function collectModelOptions(activeConfig, draftConfig) {
  return [
    ...new Set([
      draftConfig?.sessionPlanner?.model,
      draftConfig?.renderer?.model,
      activeConfig?.sessionPlanner?.model,
      activeConfig?.renderer?.model,
      ...MODEL_OPTIONS,
    ]),
  ].filter(Boolean);
}

function compareSessionSummaries(left, right) {
  if (left.id === GLOBAL_SESSION_ID) {
    return -1;
  }
  if (right.id === GLOBAL_SESSION_ID) {
    return 1;
  }

  return (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0);
}

function countRequests(events, sessionId) {
  return events.filter((event) => {
    if (event.type !== 'browser.request') {
      return false;
    }
    if (sessionId === GLOBAL_SESSION_ID) {
      return true;
    }
    return event.sessionId === sessionId;
  }).length;
}

function projectTranscript(events) {
  const relevantEvents = events.filter(
    (event) =>
      event.sessionId != null &&
      typeof event.interactionId === 'string' &&
      isTranscriptEventType(event.type),
  );
  const groups = new Map();
  for (const event of relevantEvents) {
    const existing = groups.get(event.interactionId) ?? [];
    existing.push(event);
    groups.set(event.interactionId, existing);
  }

  return [...groups.values()].map(projectInteractionGroup);
}

function isTranscriptEventType(type) {
  return (
    typeof type === 'string' &&
    (type === 'browser.request.normalized' ||
      type === 'browser.response' ||
      type === 'browser.form_binding.invalid' ||
      type.startsWith('session.plan') ||
      type.startsWith('renderer.page'))
  );
}

function projectInteractionGroup(events) {
  const ordered = [...events].sort(compareEvents);
  const requestGroups = groupByRequestId(ordered);
  const rows = [];

  for (const groupEvents of requestGroups) {
    rows.push(...projectRequestGroup(groupEvents));
  }

  const timing = buildInteractionTiming(ordered);
  const firstRequest = ordered.find(
    (event) => event.type === 'browser.request.normalized',
  );
  const lastResponse = [...ordered]
    .reverse()
    .find((event) => event.type === 'browser.response');
  const allTurns = rows.filter((entry) => entry.kind === 'turn');
  const overallEstimates = allTurns
    .map((entry) => entry.accounting)
    .filter(Boolean)
    .map((accounting) => ({
      model: accounting.models?.[0] ?? '',
      usage: accounting.usage,
      estimatedCostUsd: accounting.estimatedCostUsd,
    }));
  const overall = mergeUsageEstimates(overallEstimates);

  return compactObject({
    id: ordered[0]?.interactionId ?? `interaction-${ordered[0]?.id ?? '0'}`,
    kind: 'interaction',
    interactionId: ordered[0]?.interactionId ?? '',
    trigger: firstRequest?.trigger ?? '',
    triggerLabel: humanizeTrigger(firstRequest?.trigger ?? ''),
    path: firstRequest?.payload?.path ?? '',
    ts: firstRequest?.ts ?? ordered[0]?.ts ?? '',
    startedAt: timing.startedAt,
    endedAt: timing.endedAt,
    totalDurationMs: timing.totalDurationMs,
    requestCount: timing.requestCount,
    redirectCount: timing.redirectCount,
    status: lastResponse?.status ?? null,
    timing,
    accounting: compactObject({
      models: overall.models,
      usage: compactObject(overall.usage),
      estimatedCostUsd: overall.estimatedCostUsd,
      label: buildAccountingLabel({
        models: overall.models,
        usage: overall.usage,
        estimatedCostUsd: overall.estimatedCostUsd,
      }),
    }),
    rows,
  });
}

function groupByRequestId(events) {
  const groups = new Map();
  for (const event of events) {
    if (typeof event.requestId !== 'string') {
      continue;
    }
    const existing = groups.get(event.requestId) ?? [];
    existing.push(event);
    groups.set(event.requestId, existing);
  }
  return [...groups.values()].sort((left, right) =>
    compareEvents(left[0], right[0]),
  );
}

function projectRequestGroup(events) {
  const ordered = [...events].sort(compareEvents);
  const transcript = [];

  const plannerTurn = buildTurn({
    events: ordered,
    baseType: 'session.plan',
    lane: 'session',
    title: 'Session planner',
    inputSanitizer: sanitizePlannerInput,
    outputSanitizer: sanitizePlannerOutput,
  });
  if (plannerTurn) {
    transcript.push(plannerTurn);
  }

  const pageTurn = buildTurn({
    events: ordered,
    baseType: 'renderer.page',
    lane: 'renderer',
    title: 'Renderer page',
    inputSanitizer: sanitizeRendererPageInput,
    outputSanitizer: sanitizeRendererPageOutput,
    showInput: false,
  });
  if (plannerTurn?.output && pageTurn) {
    transcript.push({
      id: `handoff-page-${plannerTurn.id}`,
      lane: 'transfer',
      kind: 'handoff',
      label: 'page brief',
      summary: 'Planner output sent to page renderer',
      ts: pageTurn.ts ?? plannerTurn.ts,
    });
  }
  if (pageTurn) {
    transcript.push(pageTurn);
  }

  const finalPageEvent = ordered.find(
    (event) => event.type === 'renderer.page.final',
  );
  if (pageTurn && finalPageEvent) {
    pageTurn.previewHtml = buildPreviewHtml(finalPageEvent.payload?.html ?? '');
    pageTurn.metadata = compactObject({
      hasJavaScript: pageTurn.output?.hasJavaScript,
    });
  }

  return transcript;
}

function buildTurn({
  events,
  baseType,
  lane,
  title,
  inputSanitizer,
  outputSanitizer,
  showInput = true,
}) {
  const inputEvent = events.find((event) => event.type === `${baseType}.input`);
  const parsedEvents = events.filter(
    (event) => event.type === `${baseType}.parsed`,
  );
  const invalidEvents = events.filter(
    (event) => event.type === `${baseType}.invalid`,
  );
  const outputEvents = events.filter(
    (event) => event.type === `${baseType}.output`,
  );

  if (!inputEvent && parsedEvents.length === 0 && outputEvents.length === 0) {
    return null;
  }

  const latestParsed = parsedEvents.at(-1) ?? null;
  const parsedPayload = normalizeParsedPayload(latestParsed?.payload);
  const finalAttempt =
    latestParsed?.payload?.attempt ??
    outputEvents.at(-1)?.payload?.attempt ??
    0;
  const finalOutputEvent =
    outputEvents.find((event) => event.payload?.attempt === finalAttempt) ??
    outputEvents.at(-1) ??
    null;

  return {
    id: `${baseType}-${inputEvent?.id ?? latestParsed?.id ?? finalOutputEvent?.id ?? '0'}`,
    kind: 'turn',
    lane,
    title,
    ts: inputEvent?.ts ?? latestParsed?.ts ?? finalOutputEvent?.ts ?? '',
    trigger:
      inputEvent?.trigger ?? latestParsed?.trigger ?? finalOutputEvent?.trigger,
    input: showInput ? inputSanitizer(inputEvent?.payload ?? null) : null,
    reasoningSummary: normalizeOptionalString(
      finalOutputEvent?.payload?.reasoningSummary,
    ),
    output: outputSanitizer(parsedPayload),
    failedAttempts: buildFailedAttempts({
      invalidEvents,
      outputEvents,
      outputSanitizer,
    }),
    accounting: buildTurnAccounting(outputEvents),
    timing: buildTurnTiming(outputEvents),
    metadata: {},
  };
}

function buildFailedAttempts({ invalidEvents, outputEvents, outputSanitizer }) {
  return invalidEvents.map((event, index) => {
    const attemptNumber = event.payload?.attempt ?? index;
    const outputEvent =
      outputEvents.find((entry) => entry.payload?.attempt === attemptNumber) ??
      null;
    return compactObject({
      label: `Attempt ${attemptNumber + 1}`,
      reasoningSummary: normalizeOptionalString(
        outputEvent?.payload?.reasoningSummary,
      ),
      output: outputSanitizer(outputEvent?.payload?.output ?? null),
      issues: event.payload?.issues ?? '',
      accounting: buildAttemptAccounting(outputEvent),
      durationMs: outputEvent?.durationMs ?? null,
    });
  });
}

function buildTurnAccounting(outputEvents) {
  const attempts = outputEvents
    .map((event) => buildAttemptAccounting(event))
    .filter(Boolean);
  if (!attempts.length) {
    return null;
  }

  const merged = mergeUsageEstimates(
    attempts.map((attempt) => attempt.estimate),
  );
  return compactObject({
    models: merged.models,
    usage: compactObject(merged.usage),
    estimatedCostUsd: merged.estimatedCostUsd,
    label: buildAccountingLabel({
      models: merged.models,
      usage: merged.usage,
      estimatedCostUsd: merged.estimatedCostUsd,
    }),
  });
}

function buildTurnTiming(outputEvents) {
  const durations = outputEvents
    .map((event) => event.durationMs)
    .filter((value) => typeof value === 'number' && value >= 0);
  if (!durations.length) {
    return null;
  }

  const totalDurationMs = durations.reduce((sum, value) => sum + value, 0);
  return {
    totalDurationMs,
    repairDurationMs: outputEvents
      .filter((event) => (event.payload?.attempt ?? 0) > 0)
      .reduce(
        (sum, event) =>
          sum + (typeof event.durationMs === 'number' ? event.durationMs : 0),
        0,
      ),
  };
}

function buildAttemptAccounting(outputEvent) {
  const response = outputEvent?.payload?.response;
  if (!response?.usage) {
    return null;
  }

  const estimate = estimateUsageCost(response.model, response.usage);
  return compactObject({
    model: response.model,
    responseId: response.responseId,
    usage: compactObject(estimate?.usage ?? null),
    estimatedCostUsd: estimate?.estimatedCostUsd,
    label: formatUsageBadge(estimate),
    estimate,
  });
}

function buildTranscriptSummary(transcript) {
  const turns = transcript.flatMap((interaction) => interaction.rows ?? []);
  const interactionCount = transcript.length;
  const overallEstimates = turns
    .map((entry) => entry.accounting)
    .filter(Boolean)
    .map((accounting) => ({
      model: accounting.models?.[0] ?? '',
      usage: accounting.usage,
      estimatedCostUsd: accounting.estimatedCostUsd,
    }));
  const overall = mergeUsageEstimates(overallEstimates);
  const byTitle = ['Session planner', 'Renderer page']
    .map((title) => {
      const matching = turns.filter((entry) => entry.title === title);
      const estimates = matching
        .map((entry) => entry.accounting)
        .filter(Boolean)
        .map((accounting) => ({
          model: accounting.models?.[0] ?? '',
          usage: accounting.usage,
          estimatedCostUsd: accounting.estimatedCostUsd,
        }));
      const merged = mergeUsageEstimates(estimates);
      if (!merged.usage.totalTokens) {
        return null;
      }
      return compactObject({
        title,
        usage: compactObject(merged.usage),
        estimatedCostUsd: merged.estimatedCostUsd,
        label: buildAccountingLabel({
          models: merged.models,
          usage: merged.usage,
          estimatedCostUsd: merged.estimatedCostUsd,
          includeModel: false,
        }),
      });
    })
    .filter(Boolean);

  return compactObject({
    interactionCount,
    turnCount: turns.length,
    usage: compactObject(overall.usage),
    estimatedCostUsd: overall.estimatedCostUsd,
    latency: buildLatencyAggregate(transcript),
    label: buildAccountingLabel({
      models: overall.models,
      usage: overall.usage,
      estimatedCostUsd: overall.estimatedCostUsd,
      prefix: 'Session total',
      includeModel: false,
    }),
    groups: byTitle,
  });
}

function buildLatencyAggregate(transcript) {
  const durations = transcript
    .map((interaction) => interaction.totalDurationMs)
    .filter((value) => typeof value === 'number' && value >= 0)
    .sort((left, right) => left - right);
  if (!durations.length) {
    return null;
  }

  const total = durations.reduce((sum, value) => sum + value, 0);
  const slowest = durations.at(-1) ?? 0;
  const median = durations[Math.floor(durations.length / 2)] ?? 0;
  return {
    averageDurationMs: total / durations.length,
    medianDurationMs: median,
    slowestDurationMs: slowest,
  };
}

function buildAccountingLabel({
  models,
  usage,
  estimatedCostUsd,
  prefix = '',
  includeModel = true,
}) {
  if (!usage || usage.totalTokens <= 0) {
    return prefix;
  }

  const parts = [];
  if (prefix) {
    parts.push(prefix);
  }
  if (includeModel && Array.isArray(models) && models.length === 1) {
    parts.push(models[0]);
  }
  parts.push(`${formatTokenCount(usage.totalTokens)} tok`);
  if (typeof estimatedCostUsd === 'number') {
    parts.push(formatUsd(estimatedCostUsd));
  }
  return parts.join(' · ');
}

function buildInteractionTiming(events) {
  const startedAt = Math.min(
    ...events
      .map((event) => event.startedAt)
      .filter((value) => typeof value === 'number'),
  );
  const endedAt = Math.max(
    ...events
      .map((event) => event.endedAt)
      .filter((value) => typeof value === 'number'),
  );

  return compactObject({
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    endedAt: Number.isFinite(endedAt) ? endedAt : null,
    totalDurationMs:
      Number.isFinite(startedAt) && Number.isFinite(endedAt)
        ? Math.max(0, endedAt - startedAt)
        : null,
    requestCount: new Set(
      events
        .map((event) => event.requestId)
        .filter((value) => typeof value === 'string'),
    ).size,
    redirectCount: events.filter(
      (event) =>
        event.type === 'browser.response' &&
        typeof event.status === 'number' &&
        event.status >= 300 &&
        event.status < 400,
    ).length,
    breakdown: compactObject({
      normalizeDurationMs: sumEventDurations(
        events,
        'browser.request.normalized',
      ),
      plannerDurationMs: sumEventDurations(events, 'session.plan.output'),
      plannerRepairDurationMs: sumEventDurations(
        events,
        'session.plan.output',
        {
          repairsOnly: true,
        },
      ),
      rendererDurationMs: sumEventDurations(events, 'renderer.page.output'),
      rendererRepairDurationMs: sumEventDurations(
        events,
        'renderer.page.output',
        {
          repairsOnly: true,
        },
      ),
      finalizeDurationMs: sumEventDurations(events, 'renderer.page.final'),
    }),
  });
}

function sumEventDurations(events, type, options = {}) {
  const durations = events
    .filter((event) => event.type === type)
    .filter((event) =>
      options.repairsOnly ? (event.payload?.attempt ?? 0) > 0 : true,
    )
    .map((event) => event.durationMs)
    .filter((value) => typeof value === 'number' && value >= 0);
  if (!durations.length) {
    return null;
  }
  return durations.reduce((sum, value) => sum + value, 0);
}

function humanizeTrigger(trigger) {
  switch (trigger) {
    case 'seed_submit':
      return 'Seed submit';
    case 'form_submit':
      return 'Form submit';
    case 'link_click':
      return 'Link click';
    case 'redirect_follow':
      return 'Redirect follow';
    case 'reload':
      return 'Reload';
    case 'direct_visit':
      return 'Direct visit';
    default:
      return 'Interaction';
  }
}

function normalizeParsedPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return 'parsed' in payload ? payload.parsed : payload;
}

function sanitizePlannerInput(payload) {
  if (!payload) {
    return null;
  }

  return compactObject({
    seed_phrase: payload.seed_phrase,
    request: payload.request
      ? compactObject({
          method: payload.request.method,
          path: payload.request.path,
          query: payload.request.query,
          body_text: payload.request.body_text,
          form_data: payload.request.form_data,
        })
      : null,
    latest_path_state: sanitizeLatestPathState(payload.latest_path_state),
    site_style_guide: payload.site_style_guide,
    source_page: sanitizeSourcePage(payload.source_page),
  });
}

function sanitizeLatestPathState(value) {
  if (!value) {
    return null;
  }

  return compactObject({
    pageType: value.pageType ?? value.page_type,
    pageSummary: value.pageSummary ?? value.page_summary,
    title: value.title,
  });
}

function sanitizeSourcePage(value) {
  if (!value) {
    return null;
  }

  return compactObject({
    path: value.path,
    page_type: value.page_type,
    page_summary: value.page_summary,
    title: value.title,
    form: value.form
      ? compactObject({
          form_id: value.form.form_id,
          method: value.form.method,
          action: value.form.action,
          purpose: value.form.purpose,
          fields: value.form.fields,
        })
      : null,
    submission_fields: value.submission_fields,
  });
}

function sanitizePlannerOutput(value) {
  return value ? compactObject(value) : null;
}

function sanitizeRendererPageInput(value) {
  if (!value) {
    return null;
  }

  return compactObject({
    seed_phrase: value.seed_phrase,
    path: value.path,
    page_type: value.page_type,
    page_summary: value.page_summary,
    path_state_summary: value.path_state_summary,
    title: value.title,
    design_brief: value.design_brief,
    site_style_guide: value.site_style_guide,
    links: value.links,
    forms: value.forms,
    interactive_requirement: value.interactive_requirement,
  });
}

function sanitizeRendererPageOutput(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return {
      html_fragment: value,
    };
  }

  return compactObject({
    html_fragment: value.htmlFragment ?? value.html_fragment ?? value.html,
    hasJavaScript: value.hasJavaScript,
  });
}

function buildPreviewHtml(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return '';
  }
  return html;
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value.map(compactObject);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => {
        if (entryValue == null) {
          return false;
        }
        if (typeof entryValue === 'string' && entryValue.trim() === '') {
          return false;
        }
        if (Array.isArray(entryValue) && entryValue.length === 0) {
          return false;
        }
        return true;
      })
      .map(([key, entryValue]) => [key, compactObject(entryValue)]),
  );
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function compareEvents(left, right) {
  return Number.parseInt(left.id, 10) - Number.parseInt(right.id, 10);
}

function redactEvent(event) {
  return redactValue(event);
}

function redactValue(value, key = '') {
  if (REDACT_KEYS.has(key)) {
    return REDACTED;
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, key));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (
    typeof value.name === 'string' &&
    typeof value.value === 'string' &&
    ['cookie', 'set-cookie', 'authorization'].includes(value.name.toLowerCase())
  ) {
    return {
      ...value,
      value: REDACTED,
    };
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey),
    ]),
  );
}

function redactString(value) {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/gu, REDACTED)
    .replace(/(__vb_page=)([^&\s]+)/gu, `$1${REDACTED}`)
    .replace(/(name="__vb_page"\s+value=")([^"]+)(")/gu, `$1${REDACTED}$3`);
}

export { GLOBAL_SESSION_ID, MODEL_OPTIONS, REASONING_EFFORT_OPTIONS };

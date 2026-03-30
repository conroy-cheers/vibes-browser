import http from 'node:http';
import { URL } from 'node:url';

import { NO_CACHE_HEADERS } from './validation.mjs';

export function createDeveloperConsole(config, dependencies = {}) {
  const logger = dependencies.logger ?? createNullLogger();
  const runtimeState = dependencies.runtimeState;

  const server = http.createServer(async (req, res) => {
    const requestId = `console-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const requestLogger = logger.child({ requestId });
    const url = new URL(
      req.url ?? '/',
      `http://${config.consoleHost}:${config.consolePort}`,
    );

    requestLogger.info('console.request.start', {
      method: req.method,
      path: url.pathname,
    });

    try {
      if (url.pathname === '/favicon.ico') {
        writeResponse(res, 204, '', 'text/plain; charset=utf-8');
        return;
      }

      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        writeJson(res, 200, {
          sessions: runtimeState.getSessionSummaries(),
        });
        return;
      }

      if (
        url.pathname.startsWith('/api/sessions/') &&
        url.pathname.endsWith('/timeline') &&
        req.method === 'GET'
      ) {
        const sessionId = decodeURIComponent(
          url.pathname.slice('/api/sessions/'.length, -'/timeline'.length),
        );
        writeJson(res, 200, {
          sessionId,
          transcript: runtimeState.getTranscript(sessionId),
          summary: runtimeState.getTranscriptSummary(sessionId),
        });
        return;
      }

      if (url.pathname === '/api/runtime-config' && req.method === 'GET') {
        writeJson(res, 200, runtimeState.getRuntimeConfig());
        return;
      }

      if (
        url.pathname === '/api/runtime-config/apply' &&
        req.method === 'POST'
      ) {
        const body = await readJsonBody(req);
        if (body && Object.keys(body).length > 0) {
          runtimeState.updateDraft(body);
        }
        const runtimeConfig = runtimeState.applyDraft();
        runtimeState.recordEvent({
          type: 'console.config.applied',
          actor: 'console',
          sessionId: null,
          summary: 'Applied runtime config changes.',
          payload: runtimeConfig.active,
          configVersion: runtimeConfig.version,
        });
        writeJson(res, 200, runtimeConfig);
        return;
      }

      if (
        url.pathname === '/api/runtime-config/reset' &&
        req.method === 'POST'
      ) {
        const runtimeConfig = runtimeState.resetDraft();
        runtimeState.recordEvent({
          type: 'console.config.reset',
          actor: 'console',
          sessionId: null,
          summary: 'Reset runtime config editor to the last applied version.',
          payload: runtimeConfig.active,
          configVersion: runtimeConfig.version,
        });
        writeJson(res, 200, runtimeConfig);
        return;
      }

      if (url.pathname === '/' && req.method === 'GET') {
        writeResponse(
          res,
          200,
          buildConsoleHtml({
            title: 'Vibes Browser Developer Console',
          }),
          'text/html; charset=utf-8',
        );
        return;
      }

      writeJson(res, 404, {
        error: 'not_found',
      });
    } catch (error) {
      requestLogger.error('console.request.failed', {
        error: {
          message: error.message,
          stack: error.stack,
        },
      });
      writeJson(res, 500, {
        error: 'internal_error',
        message: error.message,
      });
    }
  });

  return {
    server,
    listen() {
      return new Promise((resolve) => {
        server.listen(config.consolePort, config.consoleHost, () =>
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

function buildConsoleHtml({ title }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f3ea;
        --panel: #fffdf8;
        --line: #9c8f73;
        --text: #222;
        --muted: #655a48;
        --accent: #8f2d1f;
        --trace: #f7ecd0;
        --config-width: 34rem;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Iosevka Web", "Courier New", monospace;
        color: var(--text);
        background:
          linear-gradient(180deg, rgba(255,255,255,0.5), rgba(246,243,234,0.95)),
          repeating-linear-gradient(0deg, rgba(156,143,115,0.08), rgba(156,143,115,0.08) 1px, transparent 1px, transparent 28px);
      }
      header {
        padding: 0.9rem 1rem;
        border-bottom: 2px solid var(--line);
        background: #efe6d1;
      }
      h1 { margin: 0; font-size: 1.2rem; }
      .shell {
        display: grid;
        grid-template-columns: 18rem 1fr minmax(26rem, var(--config-width));
        min-height: calc(100vh - 62px);
      }
      .panel {
        min-height: 0;
        border-right: 1px solid var(--line);
        background: rgba(255,253,248,0.96);
      }
      .panel:last-child {
        border-right: 0;
        border-left: 1px solid var(--line);
      }
      .config-panel {
        position: relative;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .resize-handle {
        position: absolute;
        left: -5px;
        top: 0;
        bottom: 0;
        width: 10px;
        cursor: col-resize;
        border: 0;
        background: transparent;
        padding: 0;
      }
      .resize-handle::before {
        content: '';
        position: absolute;
        left: 4px;
        top: 0.8rem;
        bottom: 0.8rem;
        width: 2px;
        background: linear-gradient(180deg, transparent, #b19f7b 12%, #b19f7b 88%, transparent);
      }
      .section-title {
        margin: 0;
        padding: 0.75rem 0.9rem;
        border-bottom: 1px solid var(--line);
        font-size: 0.95rem;
        background: #f1ebdd;
      }
      .sessions {
        overflow: auto;
        height: calc(100vh - 118px);
      }
      .timeline {
        display: flex;
        flex-direction: column;
        height: calc(100vh - 118px);
        min-height: 0;
      }
      .sessions button {
        width: 100%;
        text-align: left;
        border: 0;
        border-bottom: 1px solid #d2c5ab;
        background: transparent;
        padding: 0.75rem 0.9rem;
        font: inherit;
        cursor: pointer;
      }
      .sessions button.active {
        background: #fcefd8;
        border-left: 4px solid var(--accent);
        padding-left: 0.65rem;
      }
      .seed {
        color: var(--muted);
        font-size: 0.85rem;
        margin-top: 0.2rem;
      }
      .timeline-scroll {
        overflow: auto;
        flex: 1 1 auto;
        min-height: 0;
        padding: 0.75rem;
      }
      .timeline-lanes {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 7rem minmax(0, 1fr);
        gap: 0.75rem;
        position: sticky;
        top: 0;
        z-index: 1;
        margin-bottom: 0.75rem;
        background: rgba(246,243,234,0.96);
      }
      .timeline-lane-label {
        padding: 0.45rem 0.6rem;
        border: 1px solid #d7c7a8;
        background: #f8f1df;
        font-size: 0.82rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .timeline-lane-label.center {
        text-align: center;
      }
      .timeline-grid {
        display: grid;
        gap: 0.85rem;
      }
      .interaction-block {
        border: 1px solid #d6c5a4;
        background: #fffaf0;
      }
      .interaction-header {
        padding: 0.7rem 0.8rem;
        border-bottom: 1px solid #e4d6bd;
        background: #f7efdf;
      }
      .interaction-title {
        font-weight: 700;
      }
      .interaction-meta {
        margin-top: 0.2rem;
        color: var(--muted);
        font-size: 0.82rem;
      }
      .interaction-breakdown {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem 0.55rem;
        margin-top: 0.45rem;
      }
      .interaction-chip {
        border: 1px solid #d8c59c;
        background: #fffdf7;
        padding: 0.2rem 0.45rem;
        font-size: 0.77rem;
        color: #5e523e;
      }
      .timeline-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 7rem minmax(0, 1fr);
        gap: 0.75rem;
        align-items: start;
      }
      .timeline-slot {
        min-width: 0;
      }
      .timeline-arrow {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 3rem;
        color: var(--muted);
        font-size: 0.76rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .timeline-arrow::before,
      .timeline-arrow::after {
        content: '';
        flex: 1 1 auto;
        border-top: 1px dashed #bdaa84;
      }
      .timeline-arrow::before { margin-right: 0.4rem; }
      .timeline-arrow::after { margin-left: 0.4rem; }
      .timeline-arrow .arrow-label::after {
        content: ' →';
        color: var(--accent);
        font-weight: 700;
      }
      .turn-card {
        border: 1px solid #cdbd9d;
        background: var(--panel);
      }
      .turn-card > summary {
        cursor: pointer;
        padding: 0.65rem 0.75rem;
        background: #fbf5e8;
      }
      .turn-title {
        font-weight: 700;
      }
      .turn-meta {
        display: block;
        color: var(--muted);
        font-size: 0.8rem;
        margin-top: 0.18rem;
      }
      .turn-cost {
        display: block;
        color: var(--muted);
        font-size: 0.75rem;
        margin-top: 0.12rem;
      }
      .turn-timing {
        display: block;
        color: var(--muted);
        font-size: 0.75rem;
        margin-top: 0.12rem;
      }
      .turn-body {
        border-top: 1px solid #e0d5bc;
        padding: 0.75rem;
      }
      .trace-box {
        margin-bottom: 0.75rem;
        border: 1px solid #dfc898;
        background: var(--trace);
        padding: 0.65rem 0.75rem;
      }
      .trace-label {
        display: block;
        font-size: 0.76rem;
        color: var(--muted);
        text-transform: uppercase;
        margin-bottom: 0.25rem;
      }
      .trace-markdown {
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.55;
      }
      .trace-markdown p,
      .trace-markdown ul,
      .trace-markdown ol {
        margin: 0.4rem 0 0;
      }
      .trace-markdown p:first-child,
      .trace-markdown ul:first-child,
      .trace-markdown ol:first-child {
        margin-top: 0;
      }
      .trace-markdown code {
        background: rgba(255,255,255,0.55);
        padding: 0.05rem 0.22rem;
        border: 1px solid rgba(156,143,115,0.2);
      }
      .section-details {
        border: 1px solid #dbc9a8;
        background: #fffefb;
        margin-top: 0.6rem;
      }
      .section-details > summary {
        cursor: pointer;
        padding: 0.45rem 0.6rem;
        font-size: 0.84rem;
        background: #faf4e7;
      }
      .section-body {
        padding: 0.65rem 0.7rem 0.75rem;
        border-top: 1px solid #eadbc0;
      }
      .retry-item {
        margin-top: 0.55rem;
        border-top: 1px dashed #decba7;
        padding-top: 0.55rem;
      }
      .retry-item:first-child {
        margin-top: 0;
        border-top: 0;
        padding-top: 0;
      }
      .retry-title {
        font-weight: 700;
        margin-bottom: 0.35rem;
      }
      .preview-frame {
        width: 100%;
        min-height: 20rem;
        border: 1px solid #ccb98e;
        background: white;
      }
      .metadata-grid {
        display: grid;
        gap: 0.45rem;
        margin-top: 0.6rem;
      }
      .metadata-item {
        border: 1px solid #ddcba5;
        background: #fff9ed;
        padding: 0.45rem 0.55rem;
      }
      .metadata-item strong {
        display: block;
        font-size: 0.76rem;
        color: var(--muted);
        text-transform: uppercase;
        margin-bottom: 0.18rem;
      }
      .script-explanation {
        margin-top: 0.6rem;
        border: 1px solid #ddcba5;
        background: #fff9ed;
        padding: 0.55rem 0.65rem;
      }
      .script-explanation strong {
        display: block;
        font-size: 0.76rem;
        color: var(--muted);
        text-transform: uppercase;
        margin-bottom: 0.18rem;
      }
      .code-block {
        margin: 0;
        overflow: auto;
        padding: 0.7rem 0.8rem;
        border: 1px solid #d8caac;
        background: #f7f3ea;
        color: #243045;
        font: 0.88rem/1.5 "Iosevka Web", "Courier New", monospace;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .json-root {
        font-size: 0.88rem;
        line-height: 1.45;
      }
      .json-node {
        margin: 0.18rem 0 0.18rem 0.8rem;
        border-left: 1px dashed #d5c6a8;
        padding-left: 0.55rem;
      }
      .json-node > summary {
        cursor: pointer;
        list-style: none;
        padding: 0.1rem 0;
      }
      .json-node > summary::-webkit-details-marker {
        display: none;
      }
      .json-node > summary::before {
        content: '▸';
        color: var(--accent);
        display: inline-block;
        width: 0.8rem;
        margin-left: -0.8rem;
      }
      .json-node[open] > summary::before {
        content: '▾';
      }
      .json-row {
        margin: 0.12rem 0 0.12rem 0.8rem;
      }
      .json-key { color: #7c3d10; }
      .json-string { color: #0d5f4d; }
      .json-number { color: #1250aa; }
      .json-boolean { color: #8f2d1f; font-weight: 700; }
      .json-null { color: #6d6592; font-style: italic; }
      .json-preview {
        color: var(--muted);
        margin-left: 0.35rem;
        font-size: 0.82rem;
      }
      .empty-state {
        color: var(--muted);
        padding: 0.8rem;
        border: 1px dashed #ccbda0;
        background: #fffaf0;
      }
      .editor {
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1 1 auto;
      }
      .tab-strip {
        display: flex;
        gap: 0.4rem;
        padding: 0.75rem 0.75rem 0;
      }
      .tab-button {
        appearance: none;
        border: 1px solid #b7a682;
        background: #f7efdd;
        color: inherit;
        padding: 0.45rem 0.7rem;
        font: inherit;
        cursor: pointer;
      }
      .tab-button.active {
        background: #fffaf0;
        border-color: var(--accent);
        color: var(--accent);
      }
      .editor-scroll {
        overflow: auto;
        padding: 0.75rem;
        flex: 1 1 auto;
      }
      .tab-panel[hidden] {
        display: none;
      }
      .field-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-bottom: 0.9rem;
      }
      .field {
        display: grid;
        gap: 0.35rem;
      }
      .field label {
        display: block;
        font-size: 0.82rem;
        font-weight: 700;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .field select {
        width: 100%;
        padding: 0.55rem 0.6rem;
        border: 1px solid #9c8f73;
        background: #fff;
        font: inherit;
      }
      .hint {
        color: var(--muted);
        font-size: 0.83rem;
        line-height: 1.45;
        margin: 0 0 0.8rem;
      }
      .editor-box {
        margin-bottom: 0.9rem;
        border: 1px solid #ab9a77;
        background: #fffdf8;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
      }
      .editor-box-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.6rem;
        padding: 0.55rem 0.7rem;
        border-bottom: 1px solid #d8c7a4;
        background: linear-gradient(180deg, #f8f1e0, #f2e7cf);
      }
      .editor-box-title {
        font-size: 0.84rem;
        font-weight: 700;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .editor-box-copy,
      .footer-button {
        font: inherit;
        padding: 0.38rem 0.62rem;
        border: 1px solid #5e5340;
        background: #fdf4df;
        color: inherit;
        cursor: pointer;
      }
      .editor-box textarea {
        width: 100%;
        min-height: 13rem;
        resize: vertical;
        border: 0;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.94), rgba(252,248,239,0.98)),
          repeating-linear-gradient(180deg, transparent, transparent 1.55rem, rgba(156,143,115,0.08) 1.55rem, rgba(156,143,115,0.08) calc(1.55rem + 1px));
        color: #1f1a13;
        font: 0.92rem/1.55 "Iosevka Web", "Courier New", monospace;
        padding: 0.85rem 0.95rem;
        white-space: pre;
        tab-size: 2;
      }
      .editor-box textarea:focus,
      .field select:focus,
      .tab-button:focus,
      .editor-box-copy:focus,
      .footer-button:focus {
        outline: 2px solid rgba(143,45,31,0.35);
        outline-offset: 0;
      }
      .editor-footer {
        margin-top: auto;
        padding: 0.75rem;
        border-top: 1px solid var(--line);
        background: #f3ead8;
      }
      .footer-controls {
        display: flex;
        gap: 0.55rem;
      }
      .footer-button.secondary {
        background: #f7f1e4;
      }
      .status {
        color: var(--muted);
        font-size: 0.85rem;
        margin-top: 0.65rem;
        min-height: 1.2rem;
      }
      .timeline-summary {
        flex: 0 0 auto;
        border: 1px solid #cfbf9e;
        background: rgba(255,249,237,0.98);
        padding: 0.6rem 0.75rem;
        margin: 0 0.75rem 0.75rem;
      }
      .timeline-summary-title {
        font-size: 0.76rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.3rem;
      }
      .timeline-summary-line {
        font-size: 0.86rem;
      }
      .timeline-summary-groups {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem 0.9rem;
        margin-top: 0.35rem;
        color: var(--muted);
        font-size: 0.78rem;
      }
      @media (max-width: 1100px) {
        .shell { grid-template-columns: 1fr; }
        .panel, .panel:last-child {
          border-right: 0;
          border-left: 0;
          border-bottom: 1px solid var(--line);
        }
        .sessions {
          height: auto;
          max-height: 28rem;
        }
        .timeline {
          height: auto;
          max-height: none;
        }
        .editor-scroll {
          max-height: 28rem;
        }
        .timeline-lanes, .timeline-row {
          grid-template-columns: 1fr;
        }
        .timeline-lane-label.center, .timeline-arrow {
          display: none;
        }
        .resize-handle {
          display: none;
        }
        .field-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(title)}</h1>
    </header>
    <div class="shell">
      <section class="panel">
        <h2 class="section-title">Sessions</h2>
        <div class="sessions" id="sessions"></div>
      </section>
      <section class="panel">
        <h2 class="section-title">Transcript</h2>
        <div class="timeline">
          <div class="timeline-scroll">
            <div class="timeline-lanes">
              <div class="timeline-lane-label">Session Planner</div>
              <div class="timeline-lane-label center">Flow</div>
              <div class="timeline-lane-label">Renderer</div>
            </div>
            <div class="timeline-grid" id="timeline"></div>
          </div>
          <div class="timeline-summary" id="timelineSummary"></div>
        </div>
      </section>
      <section class="panel config-panel" id="configPanel">
        <button class="resize-handle" id="configResize" type="button" aria-label="Resize runtime config panel"></button>
        <h2 class="section-title">Runtime Config</h2>
        <div class="tab-strip" role="tablist" aria-label="Agent config tabs">
          <button class="tab-button active" id="sessionPlannerTab" type="button" data-tab="sessionPlanner" role="tab" aria-selected="true">Session Planner</button>
          <button class="tab-button" id="rendererTab" type="button" data-tab="renderer" role="tab" aria-selected="false">Renderer</button>
        </div>
        <div class="editor" id="editor">
          <div class="editor-scroll">
            <section class="tab-panel" data-tab-panel="sessionPlanner">
              <p class="hint">Tune the world-planning agent here. Changes apply only to future requests after you click Apply.</p>
              <div class="field-grid">
                <div class="field">
                  <label for="sessionPlannerModel">Model</label>
                  <select id="sessionPlannerModel" name="sessionPlannerModel"></select>
                </div>
                <div class="field">
                  <label for="sessionPlannerReasoningEffort">Thinking Effort</label>
                  <select id="sessionPlannerReasoningEffort" name="sessionPlannerReasoningEffort"></select>
                </div>
              </div>
              ${buildEditorBox('sessionPlannerPrompt', 'Planner Prompt')}
            </section>
            <section class="tab-panel" data-tab-panel="renderer" hidden>
              <p class="hint">Tune the stateless renderer here. The page prompt guides HTML output, including any inline JavaScript, and scaffolding captures server-owned rendering hints.</p>
              <div class="field-grid">
                <div class="field">
                  <label for="rendererModel">Model</label>
                  <select id="rendererModel" name="rendererModel"></select>
                </div>
                <div class="field">
                  <label for="rendererReasoningEffort">Thinking Effort</label>
                  <select id="rendererReasoningEffort" name="rendererReasoningEffort"></select>
                </div>
              </div>
              ${buildEditorBox('rendererPagePrompt', 'Renderer Page Prompt')}
              ${buildEditorBox('rendererScaffolding', 'Renderer Scaffolding')}
            </section>
          </div>
          <div class="editor-footer">
            <div class="footer-controls">
              <button class="footer-button" id="applyConfig" type="button">Apply</button>
              <button class="footer-button secondary" id="resetConfig" type="button">Reset</button>
            </div>
            <div class="status" id="configStatus"></div>
          </div>
        </div>
      </section>
    </div>
    <script>
      const state = {
        selectedSessionId: '__global__',
        timelineSignature: '',
        openEntries: new Set(),
        closedEntries: new Set(),
        openJsonNodes: new Set(),
        openSections: new Set(),
        closedSections: new Set(),
        activeTab: 'sessionPlanner',
        runtimeConfig: null,
        pendingConfig: null,
        configStatus: '',
      };
      const CONFIG_WIDTH_STORAGE_KEY = 'vibes-browser.console.configWidth';
      const MIN_CONFIG_WIDTH = 420;

      async function fetchJson(url, options) {
        const response = await fetch(url, options);
        if (!response.ok) {
          throw new Error('Request failed: ' + response.status);
        }
        return response.json();
      }

      async function refreshSessions() {
        const payload = await fetchJson('/api/sessions');
        const container = document.getElementById('sessions');
        container.innerHTML = '';
        const sessions = payload.sessions.filter((entry) => entry.id !== '__global__');

        if (
          sessions.length &&
          !sessions.some((entry) => entry.id === state.selectedSessionId)
        ) {
          state.selectedSessionId = sessions[0].id;
          state.timelineSignature = '';
        }

        for (const session of sessions) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.sessionId = session.id;
          if (session.id === state.selectedSessionId) {
            button.className = 'active';
          }
          button.innerHTML =
            '<div>' + escapeHtml(session.seedPhrase || 'Untitled session') + '</div>' +
            '<div class="seed">' + escapeHtml(formatSessionMeta(session)) + '</div>';
          button.addEventListener('click', () => {
            state.selectedSessionId = session.id;
            state.timelineSignature = '';
            state.openEntries = new Set();
            state.closedEntries = new Set();
            state.openJsonNodes = new Set();
            state.openSections = new Set();
            state.closedSections = new Set();
            refreshSessions().catch(showError);
            refreshTimeline().catch(showError);
          });
          container.appendChild(button);
        }

        if (!container.children.length) {
          const empty = document.createElement('div');
          empty.className = 'empty-state';
          empty.textContent = 'No live sessions yet.';
          container.appendChild(empty);
        }
      }

      async function refreshTimeline() {
        if (state.selectedSessionId === '__global__') {
          return;
        }
        const payload = await fetchJson(
          '/api/sessions/' +
            encodeURIComponent(state.selectedSessionId) +
            '/timeline',
        );
        const container = document.getElementById('timeline');
        const scrollContainer = document.querySelector('.timeline-scroll');
        const signature = JSON.stringify(payload.transcript);
        if (signature === state.timelineSignature) {
          renderTimelineSummary(payload.summary);
          return;
        }

        captureOpenState(container);
        const scrollState = captureTimelineScroll(scrollContainer, container);
        state.timelineSignature = signature;
        container.replaceChildren();

        if (!payload.transcript.length) {
          const empty = document.createElement('div');
          empty.className = 'empty-state';
          empty.textContent = 'No agent transcript for this session yet.';
          container.appendChild(empty);
          renderTimelineSummary(payload.summary);
          restoreTimelineScroll(scrollContainer, container, scrollState);
          return;
        }

        for (const interaction of payload.transcript) {
          container.appendChild(renderInteraction(interaction));
        }
        renderTimelineSummary(payload.summary);
        restoreTimelineScroll(scrollContainer, container, scrollState);
      }

      async function refreshConfig() {
        const payload = await fetchJson('/api/runtime-config');
        state.runtimeConfig = payload;
        state.pendingConfig = clone(payload.draft);
        renderRuntimeConfig();
        setConfigStatus('Active version ' + payload.version + '.');
      }

      async function applyRuntimeConfig() {
        syncPendingConfigFromDom();
        const payload = await fetchJson('/api/runtime-config/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(state.pendingConfig),
        });
        state.runtimeConfig = payload;
        state.pendingConfig = clone(payload.draft);
        renderRuntimeConfig();
        setConfigStatus('Applied. Active version ' + payload.version + '.');
        refreshTimeline().catch(showError);
      }

      async function resetRuntimeConfig() {
        const payload = await fetchJson('/api/runtime-config/reset', {
          method: 'POST',
        });
        state.runtimeConfig = payload;
        state.pendingConfig = clone(payload.draft);
        renderRuntimeConfig();
        setConfigStatus('Reset to active version ' + payload.version + '.');
      }

      function renderRuntimeConfig() {
        if (!state.runtimeConfig || !state.pendingConfig) {
          return;
        }

        populateSelect(
          document.getElementById('sessionPlannerModel'),
          state.runtimeConfig.options.modelOptions,
          state.pendingConfig.sessionPlanner.model,
        );
        populateSelect(
          document.getElementById('rendererModel'),
          state.runtimeConfig.options.modelOptions,
          state.pendingConfig.renderer.model,
        );
        populateSelect(
          document.getElementById('sessionPlannerReasoningEffort'),
          state.runtimeConfig.options.reasoningEffortOptions,
          state.pendingConfig.sessionPlanner.reasoningEffort,
        );
        populateSelect(
          document.getElementById('rendererReasoningEffort'),
          state.runtimeConfig.options.reasoningEffortOptions,
          state.pendingConfig.renderer.reasoningEffort,
        );

        document.getElementById('sessionPlannerPrompt').value =
          state.pendingConfig.sessionPlanner.prompt || '';
        document.getElementById('rendererPagePrompt').value =
          state.pendingConfig.renderer.pagePrompt || '';
        document.getElementById('rendererScaffolding').value =
          state.pendingConfig.renderer.scaffolding || '';

        setActiveTab(state.activeTab);
        updateConfigStatus();
      }

      function populateSelect(select, options, value) {
        const entries = [...new Set([value, ...(options || [])].filter(Boolean))];
        select.replaceChildren();
        for (const optionValue of entries) {
          const option = document.createElement('option');
          option.value = optionValue;
          option.textContent = optionValue;
          if (optionValue === value) {
            option.selected = true;
          }
          select.appendChild(option);
        }
      }

      function syncPendingConfigFromDom() {
        if (!state.pendingConfig) {
          return;
        }

        state.pendingConfig = {
          sessionPlanner: {
            model: document.getElementById('sessionPlannerModel').value,
            reasoningEffort: document.getElementById('sessionPlannerReasoningEffort').value,
            prompt: document.getElementById('sessionPlannerPrompt').value,
          },
          renderer: {
            model: document.getElementById('rendererModel').value,
            reasoningEffort: document.getElementById('rendererReasoningEffort').value,
            pagePrompt: document.getElementById('rendererPagePrompt').value,
            scaffolding: document.getElementById('rendererScaffolding').value,
          },
        };
        updateConfigStatus();
      }

      function updateConfigStatus() {
        if (!state.runtimeConfig || !state.pendingConfig) {
          return;
        }

        const dirty =
          JSON.stringify(state.pendingConfig) !==
          JSON.stringify(state.runtimeConfig.active);
        const message =
          state.configStatus ||
          ('Active version ' +
            state.runtimeConfig.version +
            (dirty ? ' • Unsaved changes' : ' • No local edits'));
        document.getElementById('configStatus').textContent = message;
      }

      function setConfigStatus(message) {
        state.configStatus = message;
        updateConfigStatus();
        window.clearTimeout(setConfigStatus.timer);
        setConfigStatus.timer = window.setTimeout(() => {
          state.configStatus = '';
          updateConfigStatus();
        }, 2400);
      }

      function setActiveTab(tabName) {
        state.activeTab = tabName;
        for (const button of document.querySelectorAll('.tab-button')) {
          const active = button.dataset.tab === tabName;
          button.classList.toggle('active', active);
          button.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        for (const panel of document.querySelectorAll('[data-tab-panel]')) {
          panel.hidden = panel.dataset.tabPanel !== tabName;
        }
      }

      async function copyPrompt(targetId) {
        const textarea = document.getElementById(targetId);
        const value = textarea.value;
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
        }
        setConfigStatus('Copied ' + targetId + ' to the clipboard.');
      }

      function restoreConfigWidth() {
        const storedWidth = window.localStorage.getItem(
          CONFIG_WIDTH_STORAGE_KEY,
        );
        if (storedWidth) {
          document.documentElement.style.setProperty(
            '--config-width',
            storedWidth,
          );
        }
      }

      function clampConfigWidth(nextWidth) {
        const maxWidth = Math.max(
          MIN_CONFIG_WIDTH,
          Math.floor(window.innerWidth * 0.72),
        );
        return Math.max(MIN_CONFIG_WIDTH, Math.min(maxWidth, nextWidth));
      }

      function applyConfigWidth(nextWidth) {
        const value = clampConfigWidth(nextWidth) + 'px';
        document.documentElement.style.setProperty('--config-width', value);
        window.localStorage.setItem(CONFIG_WIDTH_STORAGE_KEY, value);
      }

      function handleResizeStart(event) {
        if (window.innerWidth <= 1100) {
          return;
        }
        event.preventDefault();
        const onMove = (moveEvent) => {
          applyConfigWidth(window.innerWidth - moveEvent.clientX);
        };
        const onUp = () => {
          document.body.style.cursor = '';
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        document.body.style.cursor = 'col-resize';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }

      function captureOpenState(container) {
        state.openEntries = new Set(
          [...container.querySelectorAll('details[data-entry-id][open]')].map(
            (node) => node.dataset.entryId,
          ),
        );
        state.openJsonNodes = new Set(
          [...container.querySelectorAll('details[data-json-path][open]')].map(
            (node) => node.dataset.jsonPath,
          ),
        );
        state.openSections = new Set(
          [...container.querySelectorAll('details[data-section-key][open]')].map(
            (node) => node.dataset.sectionKey,
          ),
        );
      }

      function renderInteraction(interaction) {
        const block = document.createElement('section');
        block.className = 'interaction-block';
        block.dataset.rowId = interaction.id;

        const header = document.createElement('div');
        header.className = 'interaction-header';

        const title = document.createElement('div');
        title.className = 'interaction-title';
        title.textContent =
          (interaction.triggerLabel || 'Interaction') +
          ' · ' +
          formatDuration(interaction.totalDurationMs);
        header.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'interaction-meta';
        const parts = [];
        if (interaction.path) {
          parts.push(interaction.path);
        }
        if (interaction.requestCount) {
          parts.push(
            interaction.requestCount +
              ' request' +
              (interaction.requestCount === 1 ? '' : 's'),
          );
        }
        if (interaction.redirectCount) {
          parts.push(
            interaction.redirectCount +
              ' redirect' +
              (interaction.redirectCount === 1 ? '' : 's'),
          );
        }
        if (interaction.accounting?.label) {
          parts.push(interaction.accounting.label);
        }
        meta.textContent = parts.join(' · ');
        header.appendChild(meta);

        const breakdown = renderInteractionBreakdown(interaction.timing);
        if (breakdown) {
          header.appendChild(breakdown);
        }
        block.appendChild(header);

        const rows = document.createElement('div');
        rows.className = 'timeline-grid';
        for (const entry of interaction.rows || []) {
          rows.appendChild(renderTranscriptRow(entry, interaction));
        }
        block.appendChild(rows);
        return block;
      }

      function renderInteractionBreakdown(timing) {
        if (!timing?.breakdown) {
          return null;
        }

        const entries = [
          ['normalize', timing.breakdown.normalizeDurationMs],
          ['planner', timing.breakdown.plannerDurationMs],
          ['planner repairs', timing.breakdown.plannerRepairDurationMs],
          ['renderer', timing.breakdown.rendererDurationMs],
          ['renderer repairs', timing.breakdown.rendererRepairDurationMs],
          ['finalize', timing.breakdown.finalizeDurationMs],
        ].filter(([, duration]) => typeof duration === 'number');
        if (!entries.length) {
          return null;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'interaction-breakdown';
        for (const [label, duration] of entries) {
          const chip = document.createElement('span');
          chip.className = 'interaction-chip';
          chip.textContent = label + ': ' + formatDuration(duration);
          wrapper.appendChild(chip);
        }
        return wrapper;
      }

      function renderTranscriptRow(entry, interaction) {
        const row = document.createElement('div');
        row.className = 'timeline-row';
        row.dataset.rowId = entry.id;

        const left = document.createElement('div');
        left.className = 'timeline-slot';
        const center = document.createElement('div');
        center.className = 'timeline-arrow';
        const right = document.createElement('div');
        right.className = 'timeline-slot';

        if (entry.kind === 'handoff') {
          center.innerHTML =
            '<span class="arrow-label">' + escapeHtml(entry.label) + '</span>';
        } else if (entry.lane === 'session') {
          left.appendChild(renderTurnCard(entry, interaction));
        } else if (entry.lane === 'renderer') {
          right.appendChild(renderTurnCard(entry, interaction));
        }

        row.appendChild(left);
        row.appendChild(center);
        row.appendChild(right);
        return row;
      }

      function captureTimelineScroll(scrollContainer, contentContainer) {
        if (!scrollContainer) {
          return null;
        }

        const containerRect = scrollContainer.getBoundingClientRect();
        const rows = [...contentContainer.querySelectorAll('.interaction-block')];
        const anchor = rows.find((row) => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > containerRect.top + 4;
        });

        if (!anchor) {
          return {
            scrollTop: scrollContainer.scrollTop,
            anchorId: '',
            offset: 0,
          };
        }

        return {
          scrollTop: scrollContainer.scrollTop,
          anchorId: anchor.dataset.rowId || '',
          offset: anchor.getBoundingClientRect().top - containerRect.top,
        };
      }

      function restoreTimelineScroll(
        scrollContainer,
        contentContainer,
        scrollState,
      ) {
        if (!scrollContainer || !scrollState) {
          return;
        }

        if (scrollState.anchorId) {
          const anchor = [...contentContainer.querySelectorAll('.interaction-block')]
            .find((row) => row.dataset.rowId === scrollState.anchorId);
          if (anchor) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const currentOffset =
              anchor.getBoundingClientRect().top - containerRect.top;
            scrollContainer.scrollTop += currentOffset - scrollState.offset;
            return;
          }
        }

        scrollContainer.scrollTop = scrollState.scrollTop;
      }

      function renderTurnCard(entry, interaction) {
        const details = document.createElement('details');
        details.className = 'turn-card';
        details.dataset.entryId = entry.id;
        details.open =
          state.openEntries.has(entry.id) ||
          (defaultEntryOpen(entry) && !state.closedEntries.has(entry.id));
        details.addEventListener('toggle', () => {
          if (details.open) {
            state.openEntries.add(entry.id);
            state.closedEntries.delete(entry.id);
          } else {
            state.openEntries.delete(entry.id);
            state.closedEntries.add(entry.id);
          }
        });

        const summary = document.createElement('summary');
        const title = document.createElement('div');
        title.className = 'turn-title';
        title.textContent = entry.title;
        summary.appendChild(title);
        if (entry.ts) {
          const meta = document.createElement('span');
          meta.className = 'turn-meta';
          meta.textContent =
            new Date(entry.ts).toLocaleTimeString() +
            (interaction?.triggerLabel ? ' · trigger: ' + interaction.triggerLabel : '');
          summary.appendChild(meta);
        }
        if (entry.accounting?.label) {
          const cost = document.createElement('span');
          cost.className = 'turn-cost';
          cost.textContent = entry.accounting.label;
          summary.appendChild(cost);
        }
        if (entry.timing?.totalDurationMs != null) {
          const timing = document.createElement('span');
          timing.className = 'turn-timing';
          const share =
            interaction?.totalDurationMs && interaction.totalDurationMs > 0
              ? Math.round(
                  (entry.timing.totalDurationMs / interaction.totalDurationMs) *
                    100,
                )
              : null;
          timing.textContent =
            'processing: ' +
            formatDuration(entry.timing.totalDurationMs) +
            (share != null ? ' · ' + share + '% of interaction' : '');
          summary.appendChild(timing);
        }
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'turn-body';

        if (entry.title === 'Session planner') {
          if (entry.input) {
            body.appendChild(
              renderSection(entry.id + ':input', 'Input', entry.input, false),
            );
          }
          if (entry.reasoningSummary) {
            body.appendChild(renderReasoningSummary(entry.reasoningSummary));
          }
          if (entry.output) {
            body.appendChild(
              renderSection(entry.id + ':output', 'Output', entry.output, false),
            );
          }
          if (entry.failedAttempts && entry.failedAttempts.length > 0) {
            body.appendChild(
              renderRetries(entry.id + ':retries', entry.failedAttempts),
            );
          }
        } else if (entry.title === 'Renderer page') {
          if (entry.failedAttempts && entry.failedAttempts.length > 0) {
            body.appendChild(
              renderRetries(entry.id + ':retries', entry.failedAttempts),
            );
          }
          if (entry.reasoningSummary) {
            body.appendChild(renderReasoningSummary(entry.reasoningSummary));
          }
          body.appendChild(renderRendererPageOutput(entry));
        }

        details.appendChild(body);
        return details;
      }

      function renderTimelineSummary(summary) {
        const container = document.getElementById('timelineSummary');
        container.replaceChildren();

        const title = document.createElement('div');
        title.className = 'timeline-summary-title';
        title.textContent = 'Session totals';
        container.appendChild(title);

        const line = document.createElement('div');
        line.className = 'timeline-summary-line';
        const parts = [];
        if (summary?.label) {
          parts.push(summary.label);
        }
        if (summary?.latency) {
          parts.push(
            'avg ' +
              formatDuration(summary.latency.averageDurationMs) +
              ' · median ' +
              formatDuration(summary.latency.medianDurationMs) +
              ' · slowest ' +
              formatDuration(summary.latency.slowestDurationMs),
          );
        }
        line.textContent = parts.join(' · ') || 'No model usage recorded yet.';
        container.appendChild(line);

        if (summary?.groups?.length) {
          const groups = document.createElement('div');
          groups.className = 'timeline-summary-groups';
          for (const group of summary.groups) {
            const item = document.createElement('span');
            item.textContent = group.title + ': ' + group.label;
            groups.appendChild(item);
          }
          container.appendChild(groups);
        }
      }

      function renderReasoningSummary(summaryText) {
        const trace = document.createElement('div');
        trace.className = 'trace-box';
        const label = document.createElement('span');
        label.className = 'trace-label';
        label.textContent = 'Reasoning summary';
        trace.appendChild(label);
        trace.appendChild(renderMarkdown(summaryText));
        return trace;
      }

      function renderRetries(sectionKey, retries) {
        const details = createSectionDetails(
          sectionKey,
          retries.length +
            ' failed attempt' +
            (retries.length === 1 ? '' : 's'),
          true,
        );
        const body = document.createElement('div');
        body.className = 'section-body';
        for (const retry of retries) {
          const block = document.createElement('div');
          block.className = 'retry-item';
          block.innerHTML =
            '<div class="retry-title">' +
            escapeHtml(retry.label || 'Retry') +
            (retry.durationMs != null
              ? ' · ' + escapeHtml(formatDuration(retry.durationMs))
              : '') +
            '</div>';
          if (retry.reasoningSummary) {
            block.appendChild(renderReasoningSummary(retry.reasoningSummary));
          }
          if (retry.output) {
            block.appendChild(
              renderInlineJson(
                retry.output,
                sectionKey + ':output:' + (retry.label || 'retry'),
                'output',
              ),
            );
          }
          if (retry.issues) {
            const issues = document.createElement('div');
            issues.className = 'metadata-item';
            issues.innerHTML =
              '<strong>Validation issues</strong>' +
              escapeHtml(retry.issues).replaceAll('\\n', '<br>');
            block.appendChild(issues);
          }
          body.appendChild(block);
        }
        details.appendChild(body);
        return details;
      }

      function renderRendererPageOutput(entry) {
        const wrapper = document.createElement('div');
        wrapper.className = 'section-details';
        const body = document.createElement('div');
        body.className = 'section-body';

        if (entry.previewHtml) {
          const iframe = document.createElement('iframe');
          iframe.className = 'preview-frame';
          iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
          iframe.srcdoc = entry.previewHtml;
          body.appendChild(iframe);
        }

        const metadata = {};
        if (entry.output && typeof entry.output === 'object') {
          if ('hasJavaScript' in entry.output) {
            metadata.hasJavaScript = entry.output.hasJavaScript;
          }
        }
        if (entry.metadata && Object.keys(entry.metadata).length > 0) {
          Object.assign(metadata, entry.metadata);
        }
        if (Object.keys(metadata).length > 0) {
          body.appendChild(renderMetadata(metadata));
        }

        const rawHtml = entry.output?.html_fragment ?? entry.output?.html;
        if (rawHtml) {
          body.appendChild(
            renderRawCodeSection(
              entry.id + ':output:html_fragment',
              'Raw HTML',
              rawHtml,
              true,
            ),
          );
        }

        wrapper.appendChild(body);
        return wrapper;
      }
      function renderMetadata(metadata) {
        const wrapper = document.createElement('div');
        wrapper.className = 'metadata-grid';
        for (const [key, value] of Object.entries(metadata)) {
          const item = document.createElement('div');
          item.className = 'metadata-item';
          item.innerHTML =
            '<strong>' +
            escapeHtml(key) +
            '</strong>' +
            escapeHtml(String(value));
          wrapper.appendChild(item);
        }
        return wrapper;
      }

      function renderSection(sectionKey, label, value, collapsed) {
        const details = createSectionDetails(sectionKey, label, collapsed);
        const body = document.createElement('div');
        body.className = 'section-body';
        body.appendChild(
          renderInlineJson(value, sectionKey + ':json', label.toLowerCase()),
        );
        details.appendChild(body);
        return details;
      }

      function renderRawCodeSection(sectionKey, label, source, collapsed) {
        const details = createSectionDetails(sectionKey, label, collapsed);
        const body = document.createElement('div');
        body.className = 'section-body';
        const pre = document.createElement('pre');
        pre.className = 'code-block';
        pre.textContent = source || '';
        body.appendChild(pre);
        details.appendChild(body);
        return details;
      }

      function createSectionDetails(sectionKey, label, collapsed) {
        const details = document.createElement('details');
        details.className = 'section-details';
        details.dataset.sectionKey = sectionKey;
        details.open =
          state.openSections.has(sectionKey) ||
          (!collapsed && !state.closedSections.has(sectionKey));
        details.addEventListener('toggle', () => {
          if (details.open) {
            state.openSections.add(sectionKey);
            state.closedSections.delete(sectionKey);
          } else {
            state.openSections.delete(sectionKey);
            state.closedSections.add(sectionKey);
          }
        });
        const summary = document.createElement('summary');
        summary.textContent = label;
        details.appendChild(summary);
        return details;
      }

      function renderInlineJson(value, path, label) {
        const container = document.createElement('div');
        container.className = 'json-root';
        container.appendChild(renderJsonValue(value, path, 0, label));
        return container;
      }

      function renderJsonValue(value, path, depth, label) {
        if (Array.isArray(value)) {
          return renderJsonCollection(
            value,
            path,
            depth,
            label,
            '[' + value.length + ' items]',
          );
        }
        if (value && typeof value === 'object') {
          return renderJsonCollection(
            Object.entries(value),
            path,
            depth,
            label,
            '{' + Object.keys(value).length + ' keys}',
            true,
          );
        }

        const row = document.createElement('div');
        row.className = 'json-row';
        if (label) {
          row.appendChild(renderKey(label));
          row.appendChild(document.createTextNode(': '));
        }
        row.appendChild(renderPrimitive(value));
        return row;
      }

      function renderJsonCollection(entries, path, depth, label, preview, isObject) {
        const details = document.createElement('details');
        details.className = 'json-node';
        details.dataset.jsonPath = path;
        details.open =
          state.openJsonNodes.has(path) || shouldAutoOpenJsonNode(path, depth);
        details.addEventListener('toggle', () => {
          if (details.open) {
            state.openJsonNodes.add(path);
          } else {
            state.openJsonNodes.delete(path);
          }
        });

        const summary = document.createElement('summary');
        if (label) {
          summary.appendChild(renderKey(label));
          summary.appendChild(document.createTextNode(': '));
        }
        const previewNode = document.createElement('span');
        previewNode.className = 'json-preview';
        previewNode.textContent = preview;
        summary.appendChild(previewNode);
        details.appendChild(summary);

        const body = document.createElement('div');
        for (const [index, entry] of entries.entries()) {
          if (isObject) {
            body.appendChild(
              renderJsonValue(
                entry[1],
                path + '.' + entry[0],
                depth + 1,
                entry[0],
              ),
            );
          } else {
            body.appendChild(
              renderJsonValue(
                entry,
                path + '[' + index + ']',
                depth + 1,
                '[' + index + ']',
              ),
            );
          }
        }
        details.appendChild(body);
        return details;
      }

      function shouldAutoOpenJsonNode(path, depth) {
        return (
          depth < 1 ||
          path.includes('.form_data') ||
          path.includes('.submission_fields')
        );
      }

      function defaultEntryOpen(entry) {
        return (
          entry.title === 'Session planner' || entry.title === 'Renderer page'
        );
      }

      function formatDuration(durationMs) {
        if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
          return 'n/a';
        }
        if (durationMs >= 1000) {
          return (durationMs / 1000).toFixed(durationMs >= 10000 ? 1 : 2) + 's';
        }
        return Math.round(durationMs) + 'ms';
      }

      function renderMarkdown(markdown) {
        const container = document.createElement('div');
        container.className = 'trace-markdown';
        const source = String(markdown || '').trim();
        if (!source) {
          return container;
        }

        const blocks = source.split(/\\n\\s*\\n/u);
        for (const block of blocks) {
          const lines = block.split('\\n').map((line) => line.trimEnd());
          if (lines.every((line) => /^[-*]\\s+/u.test(line))) {
            const list = document.createElement('ul');
            for (const line of lines) {
              const item = document.createElement('li');
              item.innerHTML = renderInlineMarkdown(line.replace(/^[-*]\\s+/u, ''));
              list.appendChild(item);
            }
            container.appendChild(list);
            continue;
          }
          if (lines.every((line) => /^\\d+\\.\\s+/u.test(line))) {
            const list = document.createElement('ol');
            for (const line of lines) {
              const item = document.createElement('li');
              item.innerHTML = renderInlineMarkdown(
                line.replace(/^\\d+\\.\\s+/u, ''),
              );
              list.appendChild(item);
            }
            container.appendChild(list);
            continue;
          }

          const paragraph = document.createElement('p');
          paragraph.innerHTML = lines
            .map((line) => renderInlineMarkdown(line))
            .join('<br>');
          container.appendChild(paragraph);
        }

        return container;
      }

      function renderInlineMarkdown(text) {
        let html = escapeHtml(text);
        html = html.replace(
          /\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/gu,
          '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
        );
        html = html.replace(/\\*\\*([^*]+)\\*\\*/gu, '<strong>$1</strong>');
        html = html.replace(/(^|[\\s(])\\*([^*]+)\\*(?=[\\s).,!?:;]|$)/gu, '$1<em>$2</em>');
        html = html.replace(/(^|[\\s(])_([^_]+)_(?=[\\s).,!?:;]|$)/gu, '$1<em>$2</em>');
        html = html.replace(/\x60([^\x60]+)\x60/gu, '<code>$1</code>');
        return html;
      }

      function renderPrimitive(value) {
        const span = document.createElement('span');
        if (typeof value === 'string') {
          span.className = 'json-string';
          span.textContent = JSON.stringify(value);
          return span;
        }
        if (typeof value === 'number') {
          span.className = 'json-number';
          span.textContent = String(value);
          return span;
        }
        if (typeof value === 'boolean') {
          span.className = 'json-boolean';
          span.textContent = String(value);
          return span;
        }
        span.className = 'json-null';
        span.textContent = value == null ? 'null' : String(value);
        return span;
      }

      function renderKey(value) {
        const span = document.createElement('span');
        span.className = 'json-key';
        span.textContent = value;
        return span;
      }

      function formatSessionMeta(session) {
        const parts = [];
        if (session.mode) {
          parts.push(session.mode);
        }
        if (session.lastSeenAt) {
          parts.push(
            'active ' + new Date(session.lastSeenAt).toLocaleTimeString(),
          );
        }
        return parts.join(' • ');
      }

      function showError(error) {
        setConfigStatus(error.message);
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function clone(value) {
        return JSON.parse(JSON.stringify(value));
      }

      document.getElementById('applyConfig').addEventListener('click', () => {
        applyRuntimeConfig().catch(showError);
      });
      document.getElementById('resetConfig').addEventListener('click', () => {
        resetRuntimeConfig().catch(showError);
      });
      document
        .getElementById('configResize')
        .addEventListener('mousedown', handleResizeStart);
      for (const tabButton of document.querySelectorAll('.tab-button')) {
        tabButton.addEventListener('click', () => {
          setActiveTab(tabButton.dataset.tab);
        });
      }
      for (const fieldId of [
        'sessionPlannerModel',
        'sessionPlannerReasoningEffort',
        'sessionPlannerPrompt',
        'rendererModel',
        'rendererReasoningEffort',
        'rendererPagePrompt',
        'rendererScaffolding',
      ]) {
        document.getElementById(fieldId).addEventListener(
          'input',
          syncPendingConfigFromDom,
        );
        document.getElementById(fieldId).addEventListener(
          'change',
          syncPendingConfigFromDom,
        );
      }
      for (const button of document.querySelectorAll('[data-copy-target]')) {
        button.addEventListener('click', () => {
          copyPrompt(button.dataset.copyTarget).catch(showError);
        });
      }

      restoreConfigWidth();
      Promise.all([refreshSessions(), refreshConfig()])
        .then(() => {
          const firstSession = document.querySelector('#sessions button');
          if (firstSession && state.selectedSessionId === '__global__') {
            state.selectedSessionId = firstSession.dataset.sessionId;
            firstSession.classList.add('active');
          }
          return refreshTimeline();
        })
        .catch(showError);
      setInterval(() => {
        refreshSessions().catch(showError);
        refreshTimeline().catch(showError);
      }, 2000);
    </script>
  </body>
</html>`;
}

function buildEditorBox(targetId, title) {
  return `<div class="editor-box">
    <div class="editor-box-header">
      <div class="editor-box-title">${escapeHtml(title)}</div>
      <button class="editor-box-copy" type="button" data-copy-target="${escapeHtml(targetId)}">Copy</button>
    </div>
    <textarea id="${escapeHtml(targetId)}" name="${escapeHtml(targetId)}" spellcheck="false"></textarea>
  </div>`;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body.trim()) {
    return {};
  }
  return JSON.parse(body);
}

function writeJson(res, status, payload) {
  writeResponse(
    res,
    status,
    JSON.stringify(payload, null, 2),
    'application/json; charset=utf-8',
  );
}

function writeResponse(res, status, body, contentType) {
  const headers = {
    ...NO_CACHE_HEADERS,
    'content-type': contentType,
    'content-length': String(Buffer.byteLength(body, 'utf8')),
  };
  res.writeHead(status, headers);
  res.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createNullLogger() {
  return {
    child() {
      return this;
    },
    info() {},
    error() {},
  };
}

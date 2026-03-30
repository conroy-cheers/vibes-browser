import { parse as parseHtml, serialize as serializeHtml } from 'parse5';
import { parse as parseJs } from 'acorn';
import postcss from 'postcss';

const ALLOWED_CONTENT_TYPES = new Set([
  'text/html',
  'text/css',
  'application/javascript',
  'application/json',
  'text/plain',
  'image/svg+xml',
]);

const FORBIDDEN_HEADERS = new Set([
  'set-cookie',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'etag',
  'last-modified',
]);

const NO_CACHE_HEADERS = {
  'cache-control': 'private, no-store, no-cache, max-age=0, must-revalidate',
  pragma: 'no-cache',
  expires: '0',
};

export function parseAndNormalizeEnvelope(rawOutput, budgets) {
  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw createValidationError('Response must be valid JSON.');
  }

  return normalizeEnvelope(parsed, budgets);
}

export function normalizeEnvelope(rawEnvelope, budgets) {
  if (!rawEnvelope || typeof rawEnvelope !== 'object') {
    throw createValidationError('Envelope must be an object.');
  }

  const { status, headers, body } = rawEnvelope;
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw createValidationError(
      'status must be an integer between 100 and 599.',
    );
  }

  if (!Array.isArray(headers)) {
    throw createValidationError('headers must be an array.');
  }

  if (typeof body !== 'string') {
    throw createValidationError('body must be a string.');
  }

  const normalizedHeaders = new Map();
  for (const entry of headers) {
    if (!entry || typeof entry !== 'object') {
      throw createValidationError('header entries must be objects.');
    }

    const name = String(entry.name ?? '')
      .trim()
      .toLowerCase();
    const value = String(entry.value ?? '').trim();
    if (!name) {
      throw createValidationError('header name cannot be empty.');
    }
    if (FORBIDDEN_HEADERS.has(name)) {
      continue;
    }
    normalizedHeaders.set(name, value);
  }

  validateStatusBodyRules(status, normalizedHeaders, body);

  const contentType = resolveContentType(status, normalizedHeaders, body);
  if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw createValidationError(`Unsupported content-type: ${contentType}`);
  }

  const budget = contentType ? budgets[contentType] : null;
  if (budget && Buffer.byteLength(body, 'utf8') > budget) {
    throw createValidationError(`Body exceeds budget for ${contentType}.`);
  }

  if (contentType) {
    validateByContentType(contentType, body);
  }

  const withInfrastructure = applyInfrastructure({
    status,
    headers: normalizedHeaders,
    body,
    contentType,
  });

  return withInfrastructure;
}

export function validateByContentType(contentType, body) {
  if (contentType === 'text/html') {
    validateHtmlDocument(body);
    return;
  }

  if (contentType === 'text/css') {
    postcss.parse(body);
    return;
  }

  if (contentType === 'application/javascript') {
    validateJavaScriptSource(body);
    return;
  }

  if (contentType === 'application/json') {
    JSON.parse(body);
    return;
  }

  if (contentType === 'image/svg+xml') {
    if (!body.includes('<svg')) {
      throw createValidationError('SVG responses must include <svg.');
    }
  }
}

function applyInfrastructure({ status, headers, body, contentType }) {
  let finalBody = body;
  if (contentType === 'text/html') {
    finalBody = injectPageshowReload(body);
    validateHtmlDocument(finalBody);
  }

  if (contentType) {
    headers.set(
      'content-type',
      ensureCharset(contentType, headers.get('content-type')),
    );
  } else {
    headers.delete('content-type');
  }
  for (const [name, value] of Object.entries(NO_CACHE_HEADERS)) {
    headers.set(name, value);
  }

  return {
    status,
    headers,
    body: finalBody,
    contentType,
  };
}

export function validateHtmlDocument(html) {
  const document = parseHtml(html);
  const htmlNode = document.childNodes.find((node) => node.nodeName === 'html');
  const doctype = document.childNodes.find(
    (node) => node.nodeName === '#documentType',
  );
  if (!doctype) {
    throw createValidationError('HTML responses must include a doctype.');
  }
  if (!htmlNode) {
    throw createValidationError('HTML responses must include an html element.');
  }

  const children = htmlNode.childNodes ?? [];
  const head = children.find((node) => node.nodeName === 'head');
  const body = children.find((node) => node.nodeName === 'body');
  if (!head || !body) {
    throw createValidationError('HTML responses must include head and body.');
  }

  const hasCharset = serializeNodes(head).includes('charset');
  const hasViewport = serializeNodes(head).includes('viewport');
  if (!hasCharset || !hasViewport) {
    throw createValidationError(
      'HTML responses must include charset and viewport metadata.',
    );
  }

  const text = extractText(body).trim();
  if (!text) {
    throw createValidationError('HTML body must contain visible content.');
  }
}

export function validateJavaScriptSource(source) {
  parseJs(source, { ecmaVersion: 'latest', sourceType: 'script' });
}

function validateStatusBodyRules(status, headers, body) {
  const hasBody = body.trim().length > 0;

  if (isBodyForbiddenStatus(status)) {
    if (hasBody) {
      throw createValidationError(
        `HTTP ${status} responses must not include a body.`,
      );
    }
    return;
  }

  if (isRedirectStatus(status) && !hasBody && !headers.has('location')) {
    throw createValidationError(
      'Redirect responses with an empty body must include a Location header.',
    );
  }
}

function resolveContentType(status, headers, body) {
  const explicit = headers.get('content-type');
  if (explicit) {
    return stripCharset(explicit);
  }

  if (!body.trim() && canOmitContentType(status, headers)) {
    return null;
  }

  return 'text/html';
}

function canOmitContentType(status, headers) {
  return (
    isBodyForbiddenStatus(status) ||
    (isRedirectStatus(status) && headers.has('location'))
  );
}

function isBodyForbiddenStatus(status) {
  return (
    (status >= 100 && status < 200) ||
    status === 204 ||
    status === 205 ||
    status === 304
  );
}

function isRedirectStatus(status) {
  return status >= 300 && status < 400;
}

function extractText(node) {
  if (!node) {
    return '';
  }

  if (node.nodeName === '#text') {
    return node.value ?? '';
  }

  return (node.childNodes ?? []).map(extractText).join(' ');
}

function serializeNodes(node) {
  if (!node) {
    return '';
  }

  const attrs = (node.attrs ?? [])
    .map((attr) => `${attr.name}=${attr.value}`)
    .join(' ');
  return [attrs, ...(node.childNodes ?? []).map(serializeNodes)].join(' ');
}

function injectPageshowReload(html) {
  const snippet = `<script>window.addEventListener('pageshow',function(event){if(event.persisted){location.reload();}});</script>`;
  if (html.includes('event.persisted')) {
    return html;
  }

  if (/<\/body>/iu.test(html)) {
    return html.replace(/<\/body>/iu, `${snippet}</body>`);
  }

  return `${html}${snippet}`;
}

export function finalizeRenderedHtml(html, options = {}) {
  const siteStyleGuide = normalizeSiteStyleGuide(options.siteStyleGuide);
  const initialHtml = buildSiteShellDocument({
    title: options.title,
    siteStyleGuide,
    pageHtml: html,
  });
  validateHtmlDocument(initialHtml);

  const document = parseHtml(initialHtml);
  const body = findFirstElement(document, 'body');
  const pageRoot = findElementByAttr(document, 'data-vb-page', 'true');
  if (!body || !pageRoot) {
    throw createValidationError(
      'Rendered page shell must include a body and page content root.',
    );
  }

  validateFragmentStructure(pageRoot);
  const styleTags = findElements(pageRoot, 'style');
  scopePageStyleTags(styleTags);
  const scriptTags = findElements(pageRoot, 'script');
  validateInlineScripts(scriptTags);
  if (options.requireInlineScripts && scriptTags.length === 0) {
    throw createValidationError(
      'Rendered HTML must include at least one inline script tag when JavaScript is required.',
    );
  }
  if (!extractText(pageRoot).trim()) {
    throw createValidationError(
      'Rendered page content must contain visible text.',
    );
  }

  const declaredForms = Array.isArray(options.forms) ? options.forms : [];
  const existingForms = findElements(pageRoot, 'form');
  if (declaredForms.length > 0 || existingForms.length > 0) {
    validateAndInjectForms(
      pageRoot,
      declaredForms,
      options.formTokens ?? {},
      pageRoot,
    );
  }

  appendInlineScript(body, PAGESHOW_RELOAD_SNIPPET, 'event.persisted');

  const finalHtml = serializeHtml(document);
  validateHtmlDocument(finalHtml);
  return finalHtml;
}

export function extractDomContract(html) {
  const document = parseHtml(html);
  const elementIds = [];
  const formIds = [];

  visitNodes(document, (node) => {
    if (!node?.tagName) {
      return;
    }

    const id = getAttr(node, 'id');
    if (id) {
      elementIds.push(id);
    }

    if (node.tagName === 'form') {
      const formId = getAttr(node, 'data-vb-form-id');
      if (formId) {
        formIds.push(formId);
      }
    }
  });

  return {
    element_ids: elementIds,
    form_ids: formIds,
  };
}

function validateAndInjectForms(
  rootNode,
  declaredForms,
  formTokens,
  appendTarget,
) {
  const formNodes = findElements(rootNode, 'form');
  const declaredById = new Map(
    declaredForms.map((form) => [form.formId, form]),
  );
  const seen = new Set();

  for (const formNode of formNodes) {
    const inferredFormId =
      getAttr(formNode, 'data-vb-form-id') ??
      inferFormId(formNode, declaredForms, seen);
    if (!inferredFormId) {
      throw createValidationError(
        'Rendered HTML forms must include data-vb-form-id attributes.',
      );
    }
    setAttr(formNode, 'data-vb-form-id', inferredFormId);

    const declared = declaredById.get(inferredFormId);
    if (!declared) {
      throw createValidationError(
        `Rendered undeclared form: ${inferredFormId}`,
      );
    }
    if (seen.has(inferredFormId)) {
      throw createValidationError(`Rendered duplicate form: ${inferredFormId}`);
    }
    seen.add(inferredFormId);

    const method = (getAttr(formNode, 'method') ?? 'GET').toUpperCase();
    const action = getAttr(formNode, 'action') ?? '';
    if (method !== declared.method) {
      throw createValidationError(
        `Rendered form ${inferredFormId} must use method ${declared.method}.`,
      );
    }
    if (action !== declared.action) {
      throw createValidationError(
        `Rendered form ${inferredFormId} must use action ${declared.action}.`,
      );
    }

    const fieldNames = new Set(
      findFormFields(formNode)
        .map((fieldNode) => getAttr(fieldNode, 'name'))
        .filter(Boolean),
    );
    for (const field of declared.fields) {
      if (!fieldNames.has(field.name)) {
        appendMissingFormField(formNode, field);
        fieldNames.add(field.name);
      }
    }

    const token = formTokens[inferredFormId];
    if (!token) {
      throw createValidationError(
        `Missing hidden page token for form ${inferredFormId}.`,
      );
    }
    appendHiddenInput(formNode, '__vb_page', token);
  }

  for (const form of declaredForms) {
    if (!seen.has(form.formId)) {
      if (!appendTarget) {
        throw createValidationError(`Rendered form ${form.formId} is missing.`);
      }
      const token = formTokens[form.formId];
      if (!token) {
        throw createValidationError(
          `Missing hidden page token for form ${form.formId}.`,
        );
      }
      appendTarget.childNodes ??= [];
      appendTarget.childNodes.push(createFallbackFormNode(form, token));
      seen.add(form.formId);
    }
  }
}

function inferFormId(formNode, declaredForms, seen) {
  const method = (getAttr(formNode, 'method') ?? 'GET').toUpperCase();
  const action = getAttr(formNode, 'action') ?? '';
  const candidates = declaredForms.filter(
    (form) =>
      !seen.has(form.formId) &&
      form.method === method &&
      form.action === action,
  );
  return candidates.length === 1 ? candidates[0].formId : null;
}

function findFormFields(formNode) {
  const fields = [];
  visitNodes(formNode, (node) => {
    if (
      node?.tagName === 'input' ||
      node?.tagName === 'textarea' ||
      node?.tagName === 'select'
    ) {
      fields.push(node);
    }
  });
  return fields;
}

function appendHiddenInput(formNode, name, value) {
  formNode.childNodes ??= [];
  formNode.childNodes.push(
    createElementNode('input', [
      { name: 'type', value: 'hidden' },
      { name: 'name', value: name },
      { name: 'value', value },
    ]),
  );
}

function createFallbackFormNode(form, token) {
  const formNode = createElementNode('form', [
    { name: 'method', value: form.method },
    { name: 'action', value: form.action },
    { name: 'data-vb-form-id', value: form.formId },
  ]);
  formNode.childNodes.push(createElementNode('h2'));
  formNode.childNodes.at(-1).childNodes.push({
    nodeName: '#text',
    value: form.purpose,
  });

  for (const field of form.fields) {
    const labelNode = createElementNode('label');
    labelNode.childNodes.push({
      nodeName: '#text',
      value: `${field.label} `,
    });
    const controlNode =
      field.type === 'textarea'
        ? createElementNode('textarea', createFieldAttrs(field))
        : createElementNode('input', createFieldAttrs(field));
    labelNode.childNodes.push(controlNode);
    formNode.childNodes.push(labelNode);
  }

  appendHiddenInput(formNode, '__vb_page', token);
  const buttonNode = createElementNode('button', [
    { name: 'type', value: 'submit' },
  ]);
  buttonNode.childNodes.push({
    nodeName: '#text',
    value: form.submitLabel,
  });
  formNode.childNodes.push(buttonNode);
  return formNode;
}

function appendMissingFormField(formNode, field) {
  const labelNode = createElementNode('label');
  labelNode.childNodes.push({
    nodeName: '#text',
    value: `${field.label} `,
  });
  const controlNode =
    field.type === 'textarea'
      ? createElementNode('textarea', createFieldAttrs(field))
      : createElementNode('input', createFieldAttrs(field));
  labelNode.childNodes.push(controlNode);
  formNode.childNodes.push(labelNode);
}

function createFieldAttrs(field) {
  const attrs = [
    { name: 'name', value: field.name },
    { name: 'placeholder', value: field.placeholder },
  ];
  if (field.required) {
    attrs.push({ name: 'required', value: '' });
  }
  if (field.type !== 'textarea') {
    attrs.push({ name: 'type', value: field.type });
  }
  return attrs;
}

function appendInlineScript(bodyNode, scriptSource, marker) {
  if (serializeHtml(bodyNode).includes(marker)) {
    return;
  }

  bodyNode.childNodes ??= [];
  bodyNode.childNodes.push({
    nodeName: 'script',
    tagName: 'script',
    attrs: [],
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    childNodes: [
      {
        nodeName: '#text',
        value: scriptSource,
      },
    ],
  });
}

function createElementNode(tagName, attrs = []) {
  return {
    nodeName: tagName,
    tagName,
    attrs,
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    childNodes: [],
  };
}

function findFirstElement(root, tagName) {
  return findElements(root, tagName)[0] ?? null;
}

function findElementByAttr(root, name, value) {
  return (
    findElements(root, null).find((node) => getAttr(node, name) === value) ??
    null
  );
}

function findElements(root, tagName) {
  const matches = [];
  visitNodes(root, (node) => {
    if (node?.tagName && (!tagName || node.tagName === tagName)) {
      matches.push(node);
    }
  });
  return matches;
}

function visitNodes(node, visitor) {
  visitor(node);
  for (const child of node?.childNodes ?? []) {
    visitNodes(child, visitor);
  }
}

function getAttr(node, name) {
  return (
    node?.attrs?.find((attribute) => attribute.name === name)?.value ?? null
  );
}

function setAttr(node, name, value) {
  node.attrs ??= [];
  const existing = node.attrs.find((attribute) => attribute.name === name);
  if (existing) {
    existing.value = value;
    return;
  }
  node.attrs.push({ name, value });
}

function validateInlineScripts(scriptTags) {
  for (const scriptNode of scriptTags) {
    const source = getAttr(scriptNode, 'src');
    if (source) {
      throw createValidationError(
        'Rendered HTML must not use external script src attributes.',
      );
    }

    const type = (getAttr(scriptNode, 'type') ?? '').trim().toLowerCase();
    if (
      type &&
      type !== 'text/javascript' &&
      type !== 'application/javascript'
    ) {
      throw createValidationError(
        `Rendered HTML script tags must use classic JavaScript, not "${type}".`,
      );
    }

    const scriptSource = extractText(scriptNode).trim();
    if (!scriptSource) {
      throw createValidationError(
        'Rendered HTML script tags must not be empty.',
      );
    }

    validateJavaScriptSource(scriptSource);
  }
}

function validateFragmentStructure(pageRoot) {
  visitNodes(pageRoot, (node) => {
    const tagName = node?.tagName?.toLowerCase?.();
    if (
      tagName &&
      ['html', 'head', 'body', 'title', 'meta', 'base', 'link'].includes(
        tagName,
      )
    ) {
      throw createValidationError(
        `Rendered page fragments must not include <${tagName}> shell elements.`,
      );
    }
  });
}

function scopePageStyleTags(styleTags) {
  for (const styleNode of styleTags) {
    const css = extractText(styleNode).trim();
    if (!css) {
      throw createValidationError(
        'Rendered HTML style tags must not be empty.',
      );
    }

    const root = postcss.parse(css);
    root.walkRules((rule) => {
      if (isInsideKeyframes(rule)) {
        return;
      }

      const selectors = rule.selectors?.length
        ? rule.selectors
        : splitSelectors(rule.selector);
      rule.selector = selectors.map(scopeSelector).join(', ');
    });

    styleNode.childNodes = [
      {
        nodeName: '#text',
        value: root.toString(),
      },
    ];
  }
}

function splitSelectors(selectorText = '') {
  return selectorText
    .split(',')
    .map((selector) => selector.trim())
    .filter(Boolean);
}

function scopeSelector(selector) {
  const normalized = selector.trim();
  if (!normalized) {
    return '[data-vb-page="true"]';
  }

  const lower = normalized.toLowerCase();
  if (
    /(^|[\s>+~,(])(?:html|body|head|header|footer)\b/u.test(lower) ||
    lower.includes(':root') ||
    lower.includes('[data-vb-shell')
  ) {
    throw createValidationError(
      `Rendered page styles must not target shell-level selectors: ${selector}`,
    );
  }

  if (lower.startsWith('[data-vb-page="true"]')) {
    return normalized;
  }

  if (lower.startsWith(':scope')) {
    return normalized.replace(/^:scope\b/iu, '[data-vb-page="true"]');
  }

  return `[data-vb-page="true"] ${normalized}`;
}

function isInsideKeyframes(rule) {
  let current = rule.parent;
  while (current) {
    if (
      current.type === 'atrule' &&
      typeof current.name === 'string' &&
      current.name.toLowerCase().includes('keyframes')
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function normalizeSiteStyleGuide(styleGuide) {
  if (!styleGuide || typeof styleGuide !== 'object') {
    throw createValidationError('siteStyleGuide is required for rendering.');
  }

  return styleGuide;
}

function buildSiteShellDocument({ title, siteStyleGuide, pageHtml }) {
  const chromeTitle =
    siteStyleGuide.chrome.siteTitle || title || 'Vibes Browser Session';
  const tagline = siteStyleGuide.chrome.tagline || '';
  const footerTone = siteStyleGuide.chrome.footerTone || '';
  const pageTitle = title || chromeTitle;
  const dataAttrs = [
    attr('data-vb-density', siteStyleGuide.typography.density),
    attr('data-vb-heading', siteStyleGuide.typography.headingTreatment),
    attr('data-vb-nav-style', siteStyleGuide.components.navStyle),
    attr('data-vb-button-style', siteStyleGuide.components.buttonStyle),
    attr('data-vb-input-style', siteStyleGuide.components.inputStyle),
    attr('data-vb-card-style', siteStyleGuide.components.cardStyle),
    attr('data-vb-table-style', siteStyleGuide.components.tableStyle),
  ].join(' ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(pageTitle)}</title>
    <style data-vb-shell-style="true">
${buildShellCss(siteStyleGuide)}
    </style>
  </head>
  <body ${dataAttrs}>
    <div data-vb-shell="site">
      <header data-vb-shell="header">
        <div class="vb-shell-bar">
          <a class="vb-brand" href="/">
            <span class="vb-brand-title">${escapeHtml(chromeTitle)}</span>
            ${tagline ? `<span class="vb-brand-tagline">${escapeHtml(tagline)}</span>` : ''}
          </a>
        </div>
      </header>
      <main data-vb-main="true">
        <div data-vb-page="true">${pageHtml}</div>
      </main>
      <footer data-vb-shell="footer">
        <p>${escapeHtml(footerTone)}</p>
      </footer>
    </div>
  </body>
</html>`;
}

function buildShellCss(siteStyleGuide) {
  const palette = siteStyleGuide.palette;
  return `      :root {
        --vb-page-bg: ${safeCssValue(palette.pageBg)};
        --vb-panel-bg: ${safeCssValue(palette.panelBg)};
        --vb-panel-alt-bg: ${safeCssValue(palette.panelAltBg)};
        --vb-text: ${safeCssValue(palette.text)};
        --vb-muted: ${safeCssValue(palette.mutedText)};
        --vb-accent: ${safeCssValue(palette.accent)};
        --vb-accent-alt: ${safeCssValue(palette.accentAlt)};
        --vb-border: ${safeCssValue(palette.border)};
        --vb-body-font: ${fontStack(siteStyleGuide.typography.bodyStack)};
        --vb-display-font: ${fontStack(siteStyleGuide.typography.displayStack)};
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; }
      body {
        min-height: 100vh;
        background: var(--vb-page-bg);
        color: var(--vb-text);
        font-family: var(--vb-body-font);
        line-height: 1.45;
      }
      a { color: var(--vb-accent); }
      img, svg, iframe { max-width: 100%; }
      [data-vb-shell="site"] { min-height: 100vh; }
      .vb-shell-bar, [data-vb-main="true"], [data-vb-shell="footer"] {
        width: min(72rem, calc(100vw - 2rem));
        margin: 0 auto;
      }
      [data-vb-shell="header"] {
        border-bottom: 1px solid var(--vb-border);
        background: color-mix(in srgb, var(--vb-panel-alt-bg) 84%, white 16%);
      }
      .vb-shell-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem 0;
      }
      .vb-brand {
        display: inline-flex;
        flex-direction: column;
        gap: 0.15rem;
        text-decoration: none;
        color: inherit;
      }
      .vb-brand-title {
        font-family: var(--vb-display-font);
        font-size: 1.35rem;
        font-weight: 800;
        letter-spacing: 0.02em;
      }
      .vb-brand-tagline {
        color: var(--vb-muted);
        font-size: 0.88rem;
      }
      [data-vb-main="true"] {
        padding: 1.1rem 0 2.4rem;
      }
      [data-vb-page="true"] {
        background: var(--vb-panel-bg);
        border: 1px solid var(--vb-border);
        border-radius: ${cardRadius(siteStyleGuide.components.cardStyle)};
        box-shadow: ${cardShadow(siteStyleGuide.components.cardStyle)};
        padding: ${pagePadding(siteStyleGuide.typography.density)};
      }
      [data-vb-page="true"] h1,
      [data-vb-page="true"] h2,
      [data-vb-page="true"] h3 {
        font-family: var(--vb-display-font);
        margin: 0 0 0.8rem;
        ${headingCss(siteStyleGuide.typography.headingTreatment)}
      }
      [data-vb-page="true"] p,
      [data-vb-page="true"] ul,
      [data-vb-page="true"] ol,
      [data-vb-page="true"] table,
      [data-vb-page="true"] form,
      [data-vb-page="true"] section,
      [data-vb-page="true"] article,
      [data-vb-page="true"] nav {
        margin: 0 0 ${stackGap(siteStyleGuide.typography.density)};
      }
      [data-vb-page="true"] section,
      [data-vb-page="true"] article,
      [data-vb-page="true"] aside,
      [data-vb-page="true"] .card {
        background: ${cardBackground(siteStyleGuide.components.cardStyle)};
        border: ${cardBorder(siteStyleGuide.components.cardStyle)};
        border-radius: ${cardRadius(siteStyleGuide.components.cardStyle)};
        box-shadow: ${cardShadow(siteStyleGuide.components.cardStyle)};
        padding: ${cardPadding(siteStyleGuide.typography.density)};
      }
      [data-vb-page="true"] nav a {
        display: inline-block;
        margin: 0 0.5rem 0.5rem 0;
        text-decoration: none;
        ${navLinkCss(siteStyleGuide.components.navStyle)}
      }
      [data-vb-page="true"] button,
      [data-vb-page="true"] input,
      [data-vb-page="true"] textarea,
      [data-vb-page="true"] select {
        font: inherit;
      }
      [data-vb-page="true"] button,
      [data-vb-page="true"] input[type="submit"],
      [data-vb-page="true"] input[type="button"] {
        ${buttonCss(siteStyleGuide.components.buttonStyle)}
      }
      [data-vb-page="true"] input:not([type="submit"]):not([type="button"]),
      [data-vb-page="true"] textarea,
      [data-vb-page="true"] select {
        width: 100%;
        ${inputCss(siteStyleGuide.components.inputStyle)}
      }
      [data-vb-page="true"] label {
        display: block;
        font-weight: 700;
        margin-bottom: 0.4rem;
      }
      [data-vb-page="true"] table {
        width: 100%;
        border-collapse: collapse;
        ${tableCss(siteStyleGuide.components.tableStyle)}
      }
      [data-vb-page="true"] th,
      [data-vb-page="true"] td {
        padding: 0.55rem 0.7rem;
      }
      [data-vb-shell="footer"] {
        border-top: 1px solid var(--vb-border);
        color: var(--vb-muted);
        padding: 0.8rem 0 1.6rem;
        font-size: 0.88rem;
      }
      @media (max-width: 720px) {
        .vb-shell-bar, [data-vb-main="true"], [data-vb-shell="footer"] {
          width: calc(100vw - 1.2rem);
        }
        [data-vb-page="true"] {
          padding: 1rem;
        }
      }`;
}

function attr(name, value) {
  return `${name}="${escapeHtml(String(value ?? ''))}"`;
}

function safeCssValue(value) {
  return String(value ?? '')
    .replace(/[;\n\r{}]/gu, '')
    .trim();
}

function fontStack(kind) {
  switch (kind) {
    case 'serif':
      return `"Georgia", "Times New Roman", serif`;
    case 'mono':
      return `"Courier New", "Liberation Mono", monospace`;
    case 'humanist':
      return `"Trebuchet MS", "Gill Sans", "Helvetica Neue", sans-serif`;
    case 'sans':
    default:
      return `"Verdana", "Geneva", sans-serif`;
  }
}

function headingCss(kind) {
  switch (kind) {
    case 'caps':
      return 'text-transform: uppercase; letter-spacing: 0.08em;';
    case 'poster':
      return 'font-weight: 900; letter-spacing: -0.03em;';
    case 'plain':
    default:
      return 'font-weight: 800;';
  }
}

function pagePadding(density) {
  switch (density) {
    case 'compact':
      return '1rem';
    case 'roomy':
      return '1.7rem';
    case 'standard':
    default:
      return '1.35rem';
  }
}

function cardPadding(density) {
  switch (density) {
    case 'compact':
      return '0.85rem';
    case 'roomy':
      return '1.2rem';
    case 'standard':
    default:
      return '1rem';
  }
}

function stackGap(density) {
  switch (density) {
    case 'compact':
      return '0.85rem';
    case 'roomy':
      return '1.35rem';
    case 'standard':
    default:
      return '1rem';
  }
}

function cardRadius(style) {
  switch (style) {
    case 'lifted':
      return '18px';
    case 'filled':
      return '14px';
    case 'bordered':
    default:
      return '10px';
  }
}

function cardShadow(style) {
  switch (style) {
    case 'lifted':
      return '0 14px 28px rgba(0,0,0,0.12)';
    case 'filled':
      return '0 6px 14px rgba(0,0,0,0.08)';
    case 'bordered':
    default:
      return 'none';
  }
}

function cardBackground(style) {
  return style === 'filled'
    ? 'var(--vb-panel-alt-bg)'
    : 'color-mix(in srgb, var(--vb-panel-bg) 92%, white 8%)';
}

function cardBorder(style) {
  return style === 'lifted'
    ? '1px solid color-mix(in srgb, var(--vb-border) 82%, white 18%)'
    : '1px solid var(--vb-border)';
}

function navLinkCss(style) {
  switch (style) {
    case 'tabs':
      return 'padding: 0.45rem 0.7rem; border: 1px solid var(--vb-border); border-bottom-width: 3px; background: var(--vb-panel-alt-bg);';
    case 'underline':
      return 'padding: 0.2rem 0; border-bottom: 2px solid var(--vb-accent);';
    case 'pills':
    default:
      return 'padding: 0.42rem 0.72rem; border: 1px solid var(--vb-border); border-radius: 999px; background: var(--vb-panel-alt-bg);';
  }
}

function buttonCss(style) {
  switch (style) {
    case 'outline':
      return 'display:inline-flex;align-items:center;justify-content:center;padding:0.55rem 0.9rem;border:1px solid var(--vb-accent);background:transparent;color:var(--vb-accent);cursor:pointer;';
    case 'soft':
      return 'display:inline-flex;align-items:center;justify-content:center;padding:0.55rem 0.9rem;border:1px solid var(--vb-border);background:var(--vb-panel-alt-bg);color:var(--vb-text);cursor:pointer;';
    case 'solid':
    default:
      return 'display:inline-flex;align-items:center;justify-content:center;padding:0.55rem 0.9rem;border:1px solid var(--vb-accent);background:var(--vb-accent);color:#fff;cursor:pointer;';
  }
}

function inputCss(style) {
  switch (style) {
    case 'underline':
      return 'padding:0.45rem 0.2rem;border:0;border-bottom:2px solid var(--vb-border);background:transparent;color:inherit;';
    case 'soft':
      return 'padding:0.6rem 0.75rem;border:1px solid transparent;border-radius:10px;background:var(--vb-panel-alt-bg);color:inherit;';
    case 'boxed':
    default:
      return 'padding:0.6rem 0.75rem;border:1px solid var(--vb-border);border-radius:8px;background:#fff;color:inherit;';
  }
}

function tableCss(style) {
  switch (style) {
    case 'plain':
      return 'border: 0;';
    case 'lined':
      return 'border-top: 1px solid var(--vb-border); border-bottom: 1px solid var(--vb-border);';
    case 'grid':
    default:
      return 'border: 1px solid var(--vb-border);';
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function ensureCharset(contentType, currentValue) {
  if (
    contentType === 'text/html' ||
    contentType === 'text/plain' ||
    contentType === 'text/css' ||
    contentType === 'application/javascript'
  ) {
    return `${contentType}; charset=utf-8`;
  }

  return currentValue ?? contentType;
}

function stripCharset(contentType) {
  return contentType.split(';', 1)[0].trim().toLowerCase();
}

export function createValidationError(message, issues = [message]) {
  const error = new Error(message);
  error.issues = issues;
  return error;
}

export function formatValidationIssues(error) {
  const issues =
    Array.isArray(error?.issues) && error.issues.length > 0
      ? error.issues
      : [error?.message ?? 'Unknown validation error.'];

  return issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n');
}

export function headersToObject(headers) {
  return Object.fromEntries(headers.entries());
}

export { ALLOWED_CONTENT_TYPES, FORBIDDEN_HEADERS, NO_CACHE_HEADERS };

const PAGESHOW_RELOAD_SNIPPET =
  "window.addEventListener('pageshow',function(event){if(event.persisted){location.reload();}});";

import { parse as parseHtml } from 'parse5';
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
    validateHtml(body);
    return;
  }

  if (contentType === 'text/css') {
    postcss.parse(body);
    return;
  }

  if (contentType === 'application/javascript') {
    parseJs(body, { ecmaVersion: 'latest', sourceType: 'script' });
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
    validateHtml(finalBody);
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

function validateHtml(html) {
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

function createValidationError(message, issues = [message]) {
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

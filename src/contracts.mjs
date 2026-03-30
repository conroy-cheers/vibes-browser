import { parse as parseHtml, serializeOuter } from 'parse5';

export function parseSessionDecision(rawOutput) {
  const parsed = parseJsonObject(rawOutput);
  const kind = asEnum(
    parsed.kind,
    ['page', 'redirect', 'not_found', 'error_page'],
    'kind',
  );

  if (kind === 'page') {
    return {
      kind,
      pageType: asString(parsed.page_type, 'page_type', 80),
      pageSummary: asNonEmptyString(parsed.page_summary, 'page_summary', 500),
      pathStateSummary: asString(
        parsed.path_state_summary,
        'path_state_summary',
        500,
      ),
      title: asNonEmptyString(parsed.title, 'title', 160),
      designBrief: asNonEmptyString(parsed.design_brief, 'design_brief', 2500),
      links: parseLinks(parsed.links),
      forms: parseForms(parsed.forms),
      interactiveRequirement: parseInteractiveRequirement(
        parsed.interactive_requirement,
      ),
      siteStyleGuide: parseSiteStyleGuide(parsed.site_style_guide),
    };
  }

  if (kind === 'redirect') {
    return {
      kind,
      location: asRedirectLocation(parsed.location, 'location', 512),
      message: asString(parsed.message, 'message', 500),
    };
  }

  return {
    kind,
    title: asNonEmptyString(parsed.title, 'title', 160),
    message: asNonEmptyString(parsed.message, 'message', 500),
  };
}

export function parseRenderedPageResult(rawOutput) {
  const normalized = cleanupRenderedHtmlOutput(rawOutput);
  return asNonEmptyString(normalized, 'html_fragment', 30000);
}

export function cleanupRenderedHtmlOutput(rawOutput) {
  const asStringValue = asString(rawOutput, 'html_fragment', 120000);
  const directDecoded = decodeSimpleHtmlWrapper(asStringValue.trim());
  if (directDecoded != null) {
    return stripTrailingFence(
      extractHtmlFragment(directDecoded) ?? directDecoded,
    ).trim();
  }

  const cleaner = new StreamingHtmlCleanup();
  const output = `${cleaner.push(asStringValue)}${cleaner.finish()}`;
  const normalized =
    extractHtmlFragment(decodeSimpleHtmlWrapper(output) ?? output) ?? output;
  return stripTrailingFence(normalized).trim();
}

export class StreamingHtmlCleanup {
  #started = false;
  #prefix = '';
  #tail = '';
  #done = false;

  push(chunk) {
    if (this.#done || !chunk) {
      return '';
    }

    let text = String(chunk);
    if (!this.#started) {
      this.#prefix = stripOpeningFencePrefix(`${this.#prefix}${text}`);
      const startIndex = findHtmlStart(this.#prefix);
      if (startIndex < 0) {
        this.#prefix = this.#prefix.slice(-256);
        return '';
      }
      this.#started = true;
      text = this.#prefix.slice(startIndex);
      this.#prefix = '';
    }

    this.#tail += text;
    if (this.#tail.length <= 64) {
      return '';
    }

    const emitLength = this.#tail.length - 64;
    const emit = this.#tail.slice(0, emitLength);
    this.#tail = this.#tail.slice(emitLength);
    return emit;
  }

  finish() {
    this.#done = true;
    const pending = this.#started
      ? this.#tail
      : stripOpeningFencePrefix(this.#prefix);
    this.#prefix = '';
    this.#tail = '';
    return stripTrailingFence(pending);
  }
}

function parseJsonObject(rawOutput) {
  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw createValidationError('Response must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createValidationError('Response must be a JSON object.');
  }

  return parsed;
}

function asRedirectLocation(value, path, maxLength) {
  const location = asNonEmptyString(value, path, maxLength);
  if (!location.startsWith('/')) {
    throw createValidationError(
      `${path} must be a same-origin path starting with "/".`,
    );
  }

  if (location.startsWith('//')) {
    throw createValidationError(
      `${path} must stay on the same origin and may not start with "//".`,
    );
  }

  if (/\s/u.test(location)) {
    throw createValidationError(
      `${path} must not contain whitespace. Put user-facing prose in message instead.`,
    );
  }

  let parsed;
  try {
    parsed = new URL(location, 'http://local.test');
  } catch {
    throw createValidationError(
      `${path} must be a valid same-origin path with optional query/hash components.`,
    );
  }

  if (parsed.origin !== 'http://local.test') {
    throw createValidationError(`${path} must stay on the same origin.`);
  }

  if (!parsed.pathname.startsWith('/')) {
    throw createValidationError(
      `${path} must include a path starting with "/".`,
    );
  }

  return location;
}

function stripOpeningFencePrefix(value) {
  return value.replace(
    /^\uFEFF?\s*```(?:html|htm|xml|markdown|md|json)?\s*\r?\n/iu,
    '',
  );
}

function stripTrailingFence(value) {
  return value.replace(/\r?\n?```\s*$/u, '');
}

function findHtmlStart(value) {
  const doctypeIndex = value.search(/<!doctype html\b/iu);
  if (doctypeIndex >= 0) {
    return doctypeIndex;
  }

  const htmlIndex = value.search(/<html\b/iu);
  if (htmlIndex >= 0) {
    return htmlIndex;
  }

  return value.search(/<(?!(?:!doctype|html|head|body)\b)[a-z][^>]*>/iu);
}

function decodeSimpleHtmlWrapper(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('```json')) {
    return null;
  }

  const jsonCandidate = trimmed
    .replace(/^```json\s*\r?\n/iu, '')
    .replace(/\r?\n?```\s*$/u, '');

  try {
    const parsed = JSON.parse(jsonCandidate);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (typeof parsed.html === 'string' ||
        typeof parsed.html_fragment === 'string')
    ) {
      return parsed.html ?? parsed.html_fragment;
    }
  } catch {}

  return null;
}

function extractHtmlFragment(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (!/<!doctype html\b|<html\b/iu.test(trimmed)) {
    return trimmed;
  }

  const document = parseHtml(trimmed);
  const body = document.childNodes
    ?.find((node) => node.nodeName === 'html')
    ?.childNodes?.find((node) => node.nodeName === 'body');
  if (!body) {
    return trimmed;
  }

  return (body.childNodes ?? []).map((node) => serializeOuter(node)).join('');
}

function parseLinks(value) {
  if (!Array.isArray(value)) {
    throw createValidationError('links must be an array.');
  }

  return value.map((link, index) => {
    if (!link || typeof link !== 'object' || Array.isArray(link)) {
      throw createValidationError(`links[${index}] must be an object.`);
    }

    return {
      href: asNonEmptyString(link.href, `links[${index}].href`, 512),
      label: asNonEmptyString(link.label, `links[${index}].label`, 120),
      description: asString(
        link.description,
        `links[${index}].description`,
        240,
      ),
    };
  });
}

function parseForms(value) {
  if (!Array.isArray(value)) {
    throw createValidationError('forms must be an array.');
  }

  const seen = new Set();
  return value.map((form, index) => {
    if (!form || typeof form !== 'object' || Array.isArray(form)) {
      throw createValidationError(`forms[${index}] must be an object.`);
    }

    const formId = asNonEmptyString(
      form.form_id,
      `forms[${index}].form_id`,
      80,
    );
    if (seen.has(formId)) {
      throw createValidationError(`Duplicate form_id: ${formId}`);
    }
    seen.add(formId);

    const fields = Array.isArray(form.fields)
      ? form.fields.map((field, fieldIndex) =>
          parseField(field, `forms[${index}].fields[${fieldIndex}]`),
        )
      : (() => {
          throw createValidationError(
            `forms[${index}].fields must be an array.`,
          );
        })();

    return {
      formId,
      method: asEnum(form.method, ['GET', 'POST'], `forms[${index}].method`),
      action: asNonEmptyString(form.action, `forms[${index}].action`, 512),
      purpose: asNonEmptyString(form.purpose, `forms[${index}].purpose`, 240),
      submitLabel: asNonEmptyString(
        form.submit_label,
        `forms[${index}].submit_label`,
        80,
      ),
      fields,
    };
  });
}

function parseField(field, path) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    throw createValidationError(`${path} must be an object.`);
  }

  return {
    name: asNonEmptyString(field.name, `${path}.name`, 80),
    label: asNonEmptyString(field.label, `${path}.label`, 120),
    type: asEnum(
      field.type,
      ['text', 'search', 'email', 'url', 'number', 'textarea', 'hidden'],
      `${path}.type`,
    ),
    required: asBoolean(field.required ?? false, `${path}.required`),
    placeholder: asString(field.placeholder, `${path}.placeholder`, 160),
  };
}

function parseInteractiveRequirement(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createValidationError('interactive_requirement must be an object.');
  }

  if (!Array.isArray(value.behaviors)) {
    throw createValidationError(
      'interactive_requirement.behaviors must be an array.',
    );
  }

  return {
    required: asBoolean(
      value.required ?? false,
      'interactive_requirement.required',
    ),
    reason: asString(value.reason, 'interactive_requirement.reason', 300),
    behaviors: value.behaviors.map((entry, index) =>
      asNonEmptyString(
        entry,
        `interactive_requirement.behaviors[${index}]`,
        160,
      ),
    ),
  };
}

function parseSiteStyleGuide(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createValidationError('site_style_guide must be an object.');
  }

  return {
    themeName: asString(value.theme_name, 'site_style_guide.theme_name', 80),
    visualSummary: asString(
      value.visual_summary,
      'site_style_guide.visual_summary',
      400,
    ),
    palette: parsePalette(value.palette),
    typography: parseTypography(value.typography),
    components: parseComponents(value.components),
    chrome: parseChrome(value.chrome),
    motifs: parseMotifs(value.motifs),
  };
}

function parsePalette(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createValidationError('site_style_guide.palette must be an object.');
  }

  return {
    pageBg: asString(value.page_bg, 'site_style_guide.palette.page_bg', 32),
    panelBg: asString(value.panel_bg, 'site_style_guide.palette.panel_bg', 32),
    panelAltBg: asString(
      value.panel_alt_bg,
      'site_style_guide.palette.panel_alt_bg',
      32,
    ),
    text: asString(value.text, 'site_style_guide.palette.text', 32),
    mutedText: asString(
      value.muted_text,
      'site_style_guide.palette.muted_text',
      32,
    ),
    accent: asString(value.accent, 'site_style_guide.palette.accent', 32),
    accentAlt: asString(
      value.accent_alt,
      'site_style_guide.palette.accent_alt',
      32,
    ),
    border: asString(value.border, 'site_style_guide.palette.border', 32),
  };
}

function parseTypography(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createValidationError(
      'site_style_guide.typography must be an object.',
    );
  }

  return {
    bodyStack: asEnum(
      value.body_stack,
      ['sans', 'humanist', 'serif', 'mono'],
      'site_style_guide.typography.body_stack',
    ),
    displayStack: asEnum(
      value.display_stack,
      ['sans', 'humanist', 'serif', 'mono'],
      'site_style_guide.typography.display_stack',
    ),
    headingTreatment: asEnum(
      value.heading_treatment,
      ['plain', 'caps', 'poster'],
      'site_style_guide.typography.heading_treatment',
    ),
    density: asEnum(
      value.density,
      ['compact', 'standard', 'roomy'],
      'site_style_guide.typography.density',
    ),
  };
}

function parseComponents(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createValidationError(
      'site_style_guide.components must be an object.',
    );
  }

  return {
    navStyle: asEnum(
      value.nav_style,
      ['pills', 'tabs', 'underline'],
      'site_style_guide.components.nav_style',
    ),
    buttonStyle: asEnum(
      value.button_style,
      ['solid', 'outline', 'soft'],
      'site_style_guide.components.button_style',
    ),
    inputStyle: asEnum(
      value.input_style,
      ['boxed', 'underline', 'soft'],
      'site_style_guide.components.input_style',
    ),
    cardStyle: asEnum(
      value.card_style,
      ['bordered', 'filled', 'lifted'],
      'site_style_guide.components.card_style',
    ),
    tableStyle: asEnum(
      value.table_style,
      ['grid', 'lined', 'plain'],
      'site_style_guide.components.table_style',
    ),
  };
}

function parseChrome(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createValidationError('site_style_guide.chrome must be an object.');
  }

  return {
    siteTitle: asString(
      value.site_title,
      'site_style_guide.chrome.site_title',
      120,
    ),
    tagline: asString(value.tagline, 'site_style_guide.chrome.tagline', 160),
    footerTone: asString(
      value.footer_tone,
      'site_style_guide.chrome.footer_tone',
      240,
    ),
  };
}

function parseMotifs(value) {
  if (!Array.isArray(value)) {
    throw createValidationError('site_style_guide.motifs must be an array.');
  }

  return value.map((entry, index) =>
    asNonEmptyString(entry, `site_style_guide.motifs[${index}]`, 40),
  );
}

function asString(value, path, maxLength) {
  if (typeof value !== 'string') {
    throw createValidationError(`${path} must be a string.`);
  }
  if (value.length > maxLength) {
    throw createValidationError(`${path} exceeds ${maxLength} characters.`);
  }
  return value;
}

function asNonEmptyString(value, path, maxLength) {
  const normalized = asString(value, path, maxLength).trim();
  if (!normalized) {
    throw createValidationError(`${path} must not be empty.`);
  }
  return normalized;
}

function asBoolean(value, path) {
  if (typeof value !== 'boolean') {
    throw createValidationError(`${path} must be a boolean.`);
  }
  return value;
}

function asEnum(value, allowed, path) {
  const normalized = asString(value, path, 120);
  if (!allowed.includes(normalized)) {
    throw createValidationError(
      `${path} must be one of: ${allowed.join(', ')}.`,
    );
  }
  return normalized;
}

function createValidationError(message) {
  const error = new Error(message);
  error.issues = [message];
  return error;
}

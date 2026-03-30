const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options = {}) {
  const { level = 'info', stream = process.stderr, base = {} } = options;

  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(eventLevel, event, fields = {}) {
    if ((LEVELS[eventLevel] ?? Number.POSITIVE_INFINITY) < threshold) {
      return;
    }

    const payload = {
      ts: new Date().toISOString(),
      level: eventLevel,
      event,
      ...base,
      ...serializeFields(fields),
    };

    stream.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    level,
    base,
    child(childBase = {}) {
      return createLogger({
        level,
        stream,
        base: {
          ...base,
          ...childBase,
        },
      });
    },
    debug(event, fields) {
      write('debug', event, fields);
    },
    info(event, fields) {
      write('info', event, fields);
    },
    warn(event, fields) {
      write('warn', event, fields);
    },
    error(event, fields) {
      write('error', event, fields);
    },
  };
}

function serializeFields(fields) {
  if (!fields || typeof fields !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, serializeValue(value)]),
  );
}

function serializeValue(value) {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (value && typeof value === 'object') {
    return serializeFields(value);
  }

  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
  }

  return value;
}

export function serializeError(error) {
  if (!(error instanceof Error)) {
    return error;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error.code,
    type: error.type,
    param: error.param,
    status: error.status,
    requestID: error.requestID,
  };
}

export function summarizeRequest(requestInfo) {
  return {
    method: requestInfo.method,
    path: requestInfo.path,
    queryKeys: Object.keys(requestInfo.query ?? {}),
    headerNames: (requestInfo.headers ?? []).map((header) => header.name),
    bodyBytes: Buffer.byteLength(requestInfo.bodyText ?? '', 'utf8'),
  };
}

export function summarizeEnvelope(envelope) {
  return {
    status: envelope.status,
    contentType: envelope.contentType,
    headerNames: [...envelope.headers.keys()],
    bodyBytes: Buffer.byteLength(envelope.body ?? '', 'utf8'),
  };
}

export function summarizeResponseUsage(response) {
  return {
    responseId: response?.id,
    model: response?.model,
    usage: response?.usage
      ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
          input_tokens_details: response.usage.input_tokens_details
            ? {
                cached_tokens:
                  response.usage.input_tokens_details.cached_tokens,
              }
            : undefined,
          output_tokens_details: response.usage.output_tokens_details
            ? {
                reasoning_tokens:
                  response.usage.output_tokens_details.reasoning_tokens,
              }
            : undefined,
        }
      : undefined,
  };
}

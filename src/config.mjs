import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  host: '127.0.0.1',
  port: 8080,
  consoleHost: '127.0.0.1',
  consolePort: 8081,
  model: 'gpt-5.4-mini',
  modelOverride: null,
  plannerModel: 'gpt-5.4-mini',
  rendererModel: 'gpt-5.4-nano',
  apiBase: 'https://api.openai.com/v1',
  maxOutputTokens: 4000,
  maxOutputTokensOverride: null,
  plannerMaxOutputTokens: 900,
  rendererMaxOutputTokens: 1000,
  reasoningEffort: 'low',
  reasoningEffortOverride: null,
  plannerReasoningEffort: 'low',
  rendererReasoningEffort: 'none',
  maxRepairAttempts: 2,
  sessionTtlMinutes: 30,
  logLevel: 'info',
  requestBodyLimitBytes: 32 * 1024,
  responseBudgets: {
    'text/html': 20 * 1024,
    'text/css': 4 * 1024,
    'application/javascript': 8 * 1024,
    'application/json': 8 * 1024,
    'text/plain': 8 * 1024,
    'image/svg+xml': 12 * 1024,
  },
};

export function loadDotEnv(cwd = process.cwd()) {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator < 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function parseCliArgs(argv) {
  const args = {
    ...DEFAULTS,
    systemPromptFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${token}`);
      }
      index += 1;
      return value;
    };

    switch (token) {
      case '--host':
        args.host = next();
        break;
      case '--port':
        args.port = Number.parseInt(next(), 10);
        break;
      case '--model':
        args.model = next();
        args.modelOverride = args.model;
        break;
      case '--console-port':
        args.consolePort = Number.parseInt(next(), 10);
        break;
      case '--api-base':
        args.apiBase = next();
        break;
      case '--system-prompt-file':
        args.systemPromptFile = next();
        break;
      case '--max-output-tokens':
        args.maxOutputTokens = Number.parseInt(next(), 10);
        args.maxOutputTokensOverride = args.maxOutputTokens;
        break;
      case '--reasoning-effort':
        args.reasoningEffort = next();
        args.reasoningEffortOverride = args.reasoningEffort;
        break;
      case '--max-repair-attempts':
        args.maxRepairAttempts = Number.parseInt(next(), 10);
        break;
      case '--session-ttl-minutes':
        args.sessionTtlMinutes = Number.parseInt(next(), 10);
        break;
      case '--log-level':
        args.logLevel = next();
        break;
      case '--verbose':
        args.logLevel = 'debug';
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  validateConfig(args);
  return args;
}

function validateConfig(config) {
  if (
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535
  ) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }

  if (
    !Number.isInteger(config.consolePort) ||
    config.consolePort < 1 ||
    config.consolePort > 65535
  ) {
    throw new Error('console-port must be an integer between 1 and 65535.');
  }

  if (config.consolePort === config.port) {
    throw new Error('console-port must differ from port.');
  }

  if (
    !Number.isInteger(config.maxOutputTokens) ||
    config.maxOutputTokens <= 0
  ) {
    throw new Error('max-output-tokens must be a positive integer.');
  }

  if (
    !(
      config.reasoningEffort in
      {
        none: true,
        low: true,
        medium: true,
        high: true,
        xhigh: true,
      }
    )
  ) {
    throw new Error(
      'reasoning-effort must be one of: none, low, medium, high, xhigh.',
    );
  }

  if (
    !Number.isInteger(config.maxRepairAttempts) ||
    config.maxRepairAttempts < 0
  ) {
    throw new Error('max-repair-attempts must be a non-negative integer.');
  }

  if (
    !Number.isInteger(config.sessionTtlMinutes) ||
    config.sessionTtlMinutes <= 0
  ) {
    throw new Error('session-ttl-minutes must be a positive integer.');
  }

  if (
    !(config.logLevel in { debug: true, info: true, warn: true, error: true })
  ) {
    throw new Error('log-level must be one of: debug, info, warn, error.');
  }
}

export function getConfig(argv, cwd = process.cwd()) {
  loadDotEnv(cwd);
  const config = parseCliArgs(argv);

  const systemPrompt = config.systemPromptFile
    ? fs.readFileSync(path.resolve(cwd, config.systemPromptFile), 'utf8')
    : null;

  return {
    ...config,
    cwd,
    systemPrompt,
    apiKey: process.env.OPENAI_API_KEY ?? '',
  };
}

export function usage() {
  return [
    'Usage: vibes-browser [options]',
    '',
    'Options:',
    '  --host <host>                  Host to bind (default: 127.0.0.1)',
    '  --port <port>                  Port to bind (default: 8080)',
    '  --console-port <port>          Developer console port (default: 8081)',
    '  --model <id>                   Shared planner+renderer model override',
    '  --api-base <url>               OpenAI API base URL',
    '  --system-prompt-file <path>    Load prompt override from file',
    '  --max-output-tokens <n>        Shared planner+renderer token cap override',
    '  --reasoning-effort <level>     Shared override: none, low, medium, high, or xhigh',
    '  --max-repair-attempts <n>      Max lint-guided repair retries',
    '  --session-ttl-minutes <n>      In-memory session TTL',
    '  --log-level <level>            debug, info, warn, or error',
    '  --verbose                      Alias for --log-level debug',
    '  --help                         Show this help text',
  ].join('\n');
}

export { DEFAULTS };

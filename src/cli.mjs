#!/usr/bin/env node
import process from 'node:process';

import { createApp } from './app.mjs';
import { createDeveloperConsole } from './dev-console.mjs';
import { getConfig, usage } from './config.mjs';
import { createLogger, serializeError } from './logger.mjs';
import { OpenAIWebserverService } from './openai-service.mjs';
import { createRuntimeState } from './runtime-state.mjs';

async function main() {
  let config;
  try {
    config = getConfig(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('');
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (config.help) {
    console.log(usage());
    return;
  }

  if (!config.apiKey) {
    console.error('OPENAI_API_KEY is required.');
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({
    level: config.logLevel,
    base: {
      app: 'vibes-browser',
      pid: process.pid,
    },
  });

  logger.info('process.start', {
    host: config.host,
    port: config.port,
    consoleHost: config.consoleHost,
    consolePort: config.consolePort,
    model: config.model,
    logLevel: config.logLevel,
  });

  const runtimeState = createRuntimeState({ config });
  const openaiService = new OpenAIWebserverService(config, {
    logger,
    runtimeConfigProvider: () => runtimeState.getActiveRuntimeConfig(),
  });
  const app = createApp(config, {
    openaiService,
    logger,
    runtimeState,
  });
  const developerConsole = createDeveloperConsole(config, {
    logger,
    runtimeState,
  });

  const [address, consoleAddress] = await Promise.all([
    app.listen(),
    developerConsole.listen(),
  ]);
  const actualPort =
    typeof address === 'object' && address ? address.port : config.port;
  const actualConsolePort =
    typeof consoleAddress === 'object' && consoleAddress
      ? consoleAddress.port
      : config.consolePort;
  logger.info('server.listen', {
    host: config.host,
    port: actualPort,
  });
  logger.info('console.listen', {
    host: config.consoleHost,
    port: actualConsolePort,
  });
  console.log(`Listening on http://${config.host}:${actualPort}`);
  console.log(
    `Developer console on http://${config.consoleHost}:${actualConsolePort}`,
  );

  const shutdown = async () => {
    logger.info('process.shutdown');
    await Promise.all([app.close(), developerConsole.close()]);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  const logger = createLogger({
    level: 'error',
    base: {
      app: 'vibes-browser',
      pid: process.pid,
    },
  });
  logger.error('process.fatal', { error: serializeError(error) });
  console.error(error);
  process.exit(1);
});

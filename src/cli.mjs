#!/usr/bin/env node
import process from 'node:process';

import { createApp } from './app.mjs';
import { getConfig, usage } from './config.mjs';
import { createLogger, serializeError } from './logger.mjs';
import { OpenAIWebserverService } from './openai-service.mjs';

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
    model: config.model,
    logLevel: config.logLevel,
  });

  const openaiService = new OpenAIWebserverService(config, { logger });
  const app = createApp(config, {
    openaiService,
    logger,
  });

  const address = await app.listen();
  const actualPort =
    typeof address === 'object' && address ? address.port : config.port;
  logger.info('server.listen', {
    host: config.host,
    port: actualPort,
  });
  console.log(`Listening on http://${config.host}:${actualPort}`);

  const shutdown = async () => {
    logger.info('process.shutdown');
    await app.close();
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

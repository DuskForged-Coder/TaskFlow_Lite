import React from 'react';
import { render } from 'ink';
import { TaskFlowApplication } from './app/application.js';
import { ShutdownCoordinator } from './app/shutdown.js';
import { SingleInstanceGuard } from './app/singleInstance.js';
import { loadConfig } from './config/config.js';
import { toUserMessage } from './core/errors.js';
import { App } from './tui/App.js';
import { formatErrorDetails, logError, redactSecrets } from './utils/logging.js';
import { dirname } from 'node:path';

async function main(): Promise<void> {
  let application: TaskFlowApplication | undefined;
  let guard: SingleInstanceGuard | undefined;
  try {
    const config = loadConfig();
    // Only one process may hold the database. If the floating orb is already
    // running it has been asked to show itself, so this session simply ends
    // instead of contending for the same SQLite file.
    guard = new SingleInstanceGuard(dirname(config.databasePath));
    const alreadyRunning = guard.acquire();
    if (alreadyRunning) {
      console.log(alreadyRunning.message);
      return;
    }

    application = TaskFlowApplication.open(config);
    let unmount: () => void = () => {};
    const shutdown = new ShutdownCoordinator(application, () => unmount());
    shutdown.install();
    const instance = render(
      <App
        application={application}
        signal={shutdown.controller.signal}
        onExit={() => { void shutdown.shutdown(); }}
      />,
    );
    unmount = instance.unmount;
    await instance.waitUntilExit();
    await shutdown.shutdown();
    guard.release();
  } catch (error) {
    console.error(toUserMessage(error));
    const secrets = process.env['GEMINI_API_KEY'] ? [process.env['GEMINI_API_KEY']!] : [];
    await logError(error, secrets).catch(() => undefined);
    if (process.env['TASKFLOW_DEBUG'] === '1') {
      console.error(redactSecrets(formatErrorDetails(error), secrets));
    }
    try {
      application?.close();
    } catch (closeError) {
      await logError(new AggregateError([error, closeError], 'Application failure and shutdown both failed.'), secrets).catch(() => undefined);
      if (process.env['TASKFLOW_DEBUG'] === '1') console.error(redactSecrets(formatErrorDetails(closeError), secrets));
    }
    process.exitCode = 1;
  } finally {
    guard?.release();
  }
}

void main();
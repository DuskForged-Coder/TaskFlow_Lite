/**
 * VISIBLE acceptance test for T06 - focus-session tracker.
 *
 * Run with: corepack pnpm vitest run --config experiment/vitest.visible.config.ts
 * MUST FAIL on baseline (no focus-session storage exists).
 *
 * The test drives the application through its deterministic command surface, so
 * the exact phrasings required by the spec are pinned here.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskFlowApplication } from '../../src/app/application.js';
import { loadConfig } from '../../src/config/config.js';

describe('T06 focus-session tracker', () => {
  let directory: string | undefined;
  let application: TaskFlowApplication | undefined;

  afterEach(() => {
    application?.close();
    application = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function open(): TaskFlowApplication {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-T06-'));
    const config = loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
      TASKFLOW_AI_PROVIDER: 'none',
    });
    application = TaskFlowApplication.open(config);
    return application;
  }

  it('starts and stops a focus session for a named task', async () => {
    const app = open();
    await app.interpretRequest('add write report');

    const started = await app.interpretRequest('start focus on write report');
    expect(started.status).toBe('done');

    const stopped = await app.interpretRequest('stop focus');
    expect(stopped.status).toBe('done');
  });

  it('rejects starting a session for a task that does not exist', async () => {
    const app = open();
    await expect(app.interpretRequest('start focus on ghost task')).rejects.toThrow();
  });

  it('rejects stopping when no session is running', async () => {
    const app = open();
    await expect(app.interpretRequest('stop focus')).rejects.toThrow();
  });

  it('reports total focus minutes per task', async () => {
    const app = open();
    await app.interpretRequest('add write report');

    await app.interpretRequest('start focus on write report');
    await app.interpretRequest('stop focus');

    const report = await app.interpretRequest('show my focus time');
    expect(report.status).toBe('done');
    expect(report.message).toContain('write report');
    expect(report.message).toMatch(/\d+\s*m/);
  });

  it('persists sessions across a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taskflow-T06-restart-'));
    const config = loadConfig({
      TASKFLOW_DATABASE_PATH: join(dir, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
      TASKFLOW_AI_PROVIDER: 'none',
    });

    const first = TaskFlowApplication.open(config);
    await first.interpretRequest('add write report');
    await first.interpretRequest('start focus on write report');
    await first.interpretRequest('stop focus');
    first.close();

    application = TaskFlowApplication.open(config);
    const report = await application.interpretRequest('show my focus time');
    expect(report.status).toBe('done');
    expect(report.message).toContain('write report');

    application.close();
    application = undefined;
    rmSync(dir, { recursive: true, force: true });
  });
});

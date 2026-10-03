/**
 * VISIBLE acceptance test for T01 - deterministic `search <text>` command.
 *
 * Run with:  corepack pnpm vitest run experiment/tests-visible/T01.search.test.ts
 * This file MUST FAIL on baseline and pass only when T01 is correctly done.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskFlowApplication } from '../../src/app/application.js';
import { loadConfig } from '../../src/config/config.js';
import { parseCommand } from '../../src/commands/commandParser.js';

describe('T01 search command', () => {
  let directory: string | undefined;
  let application: TaskFlowApplication | undefined;

  afterEach(() => {
    application?.close();
    application = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function open(aiClient?: { generate: () => Promise<unknown> }): TaskFlowApplication {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-T01-'));
    const config = loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
      TASKFLOW_AI_PROVIDER: 'none',
    });
    application = TaskFlowApplication.open(config, aiClient);
    return application;
  }

  it('parses "search <text>" into a list_tasks intent with a query', () => {
    const intent = parseCommand('search dbms', { timezone: 'UTC' });
    expect(intent).toMatchObject({ type: 'list_tasks', scope: 'all', query: 'dbms' });
  });

  it('returns matching open tasks only, and never calls the AI backend', async () => {
    const generate = vi.fn();
    const app = open({ generate });

    await app.interpretRequest('add finish DBMS assignment');
    await app.interpretRequest('add buy milk');
    await app.interpretRequest('add DBMS revision');
    await app.interpretRequest('complete DBMS revision');

    const result = await app.interpretRequest('search dbms');
    expect(result.status).toBe('done');
    expect(result.message).toContain('finish DBMS assignment');
    expect(result.message).not.toContain('buy milk');
    expect(result.message).not.toContain('DBMS revision');
    expect(generate).not.toHaveBeenCalled();
  });

  it('matches case-insensitively', async () => {
    const app = open();
    await app.interpretRequest('add finish DBMS assignment');
    const result = await app.interpretRequest('search dbms');
    expect(result.status).toBe('done');
    expect(result.message).toContain('finish DBMS assignment');
  });

  it('rejects an empty search instead of listing everything', async () => {
    const app = open();
    await app.interpretRequest('add buy milk');
    await expect(app.interpretRequest('search    ')).rejects.toThrow(/phrase to search/i);
  });
});

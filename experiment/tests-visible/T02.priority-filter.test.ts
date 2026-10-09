/**
 * VISIBLE acceptance test for T02 - deterministic `show <priority>` filter.
 *
 * Run with: corepack pnpm vitest run --config experiment/vitest.visible.config.ts
 * MUST FAIL on baseline.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskFlowApplication } from '../../src/app/application.js';
import { loadConfig } from '../../src/config/config.js';
import { parseCommand } from '../../src/commands/commandParser.js';

describe('T02 priority filter command', () => {
  let directory: string | undefined;
  let application: TaskFlowApplication | undefined;

  afterEach(() => {
    application?.close();
    application = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function open(aiClient?: { generate: () => Promise<unknown> }): TaskFlowApplication {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-T02-'));
    const config = loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
      TASKFLOW_AI_PROVIDER: 'none',
    });
    application = TaskFlowApplication.open(config, aiClient);
    return application;
  }

  it('parses "show urgent" into a filtered list intent', () => {
    expect(parseCommand('show urgent', { timezone: 'UTC' }))
      .toMatchObject({ type: 'list_tasks', scope: 'all', priority: 'urgent' });
  });

  it('lists only the matching open tasks', async () => {
    const generate = vi.fn();
    const app = open({ generate });

    await app.interpretRequest('add low chore');
    await app.interpretRequest('add normal task');
    await app.interpretRequest('add high task');
    await app.interpretRequest('add urgent task');
    await app.interpretRequest('set priority of high task to high');
    await app.interpretRequest('set priority of urgent task to urgent');
    await app.interpretRequest('set priority of low chore to low');

    const urgent = await app.interpretRequest('show urgent');
    expect(urgent.status).toBe('done');
    expect(urgent.message).toContain('urgent task');
    expect(urgent.message).not.toContain('normal task');

    const high = await app.interpretRequest('show high');
    expect(high.status).toBe('done');
    expect(high.message).toContain('high task');
    expect(high.message).not.toContain('urgent task');

    const low = await app.interpretRequest('show low');
    expect(low.status).toBe('done');
    expect(low.message).toContain('low chore');
    expect(low.message).not.toContain('normal task');

    expect(generate).not.toHaveBeenCalled();
  });

  it('excludes completed tasks from the filter', async () => {
    const app = open();
    await app.interpretRequest('add finished urgent work');
    await app.interpretRequest('set priority of finished urgent work to urgent');
    await app.interpretRequest('complete finished urgent work');

    const result = await app.interpretRequest('show urgent');
    expect(result.status).toBe('done');
    expect(result.message).not.toContain('finished urgent work');
  });

  it('still returns all open tasks for "show everything"', async () => {
    const app = open();
    await app.interpretRequest('add low chore');
    await app.interpretRequest('add urgent task');
    await app.interpretRequest('set priority of urgent task to urgent');

    const result = await app.interpretRequest('show everything');
    expect(result.status).toBe('done');
    expect(result.message).toContain('low chore');
    expect(result.message).toContain('urgent task');
  });
});

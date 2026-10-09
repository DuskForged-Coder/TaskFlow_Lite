/**
 * VISIBLE acceptance test for T10 - backup and restore.
 *
 * Run with: corepack pnpm vitest run --config experiment/vitest.visible.config.ts
 * MUST FAIL on baseline.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskFlowApplication } from '../../src/app/application.js';
import { loadConfig } from '../../src/config/config.js';

describe('T10 backup and restore', () => {
  let directory: string | undefined;
  let application: TaskFlowApplication | undefined;

  afterEach(() => {
    application?.close();
    application = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function open(): TaskFlowApplication {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-T10-'));
    const config = loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
      TASKFLOW_AI_PROVIDER: 'none',
    });
    application = TaskFlowApplication.open(config);
    return application;
  }

  function countRows(path: string): { tasks: number; history: number } {
    const db = new Database(path, { readonly: true });
    try {
      const tasks = db.prepare('SELECT COUNT(*) AS total FROM tasks').get() as { total: number };
      const history = db.prepare('SELECT COUNT(*) AS total FROM task_history').get() as { total: number };
      return { tasks: Number(tasks.total), history: Number(history.total) };
    } finally {
      db.close();
    }
  }

  it('writes a valid SQLite backup containing tasks and history', async () => {
    const app = open();
    await app.interpretRequest('add alpha task');
    await app.interpretRequest('set priority of alpha task to high');
    await app.interpretRequest('add beta task');

    const target = join(directory!, 'backup.db');
    const result = await app.interpretRequest(`backup ${target}`);
    expect(result.status).toBe('done');
    expect(existsSync(target)).toBe(true);

    const live = countRows(join(directory!, 'tasks.sqlite3'));
    const saved = countRows(target);
    expect(saved.tasks).toBe(live.tasks);
    expect(saved.history).toBe(live.history);
  });

  it('requires confirmation before restoring over live data', async () => {
    const app = open();
    await app.interpretRequest('add alpha task');
    const target = join(directory!, 'backup.db');
    await app.interpretRequest(`backup ${target}`);
    await app.interpretRequest('add task created post backup');

    const proposal = await app.interpretRequest(`restore ${target}`);
    expect(proposal.status).toBe('confirmation');
    if (proposal.status !== 'confirmation') throw new Error('Expected a confirmation proposal');

    // Declining must leave live data untouched.
    expect(app.confirmRequest(proposal.intent, false).status).toBe('done');
    const after = await app.interpretRequest('show my tasks');
    expect(after.message).toContain('task created post backup');
  });

  it('restores the backup contents when confirmed', async () => {
    const app = open();
    await app.interpretRequest('add alpha task');
    const target = join(directory!, 'backup.db');
    await app.interpretRequest(`backup ${target}`);
    await app.interpretRequest('add task created post backup');

    const proposal = await app.interpretRequest(`restore ${target}`);
    if (proposal.status !== 'confirmation') throw new Error('Expected a confirmation proposal');
    app.confirmRequest(proposal.intent, true);

    const after = await app.interpretRequest('show my tasks');
    expect(after.message).toContain('alpha task');
    expect(after.message).not.toContain('task created post backup');
  });

  it('reports a missing backup file and a corrupt file without crashing', async () => {
    const app = open();
    await app.interpretRequest('add alpha task');

    await expect(app.interpretRequest(`restore ${join(directory!, 'nope.db')}`)).rejects.toThrow();

    const corrupt = join(directory!, 'corrupt.db');
    writeFileSync(corrupt, 'this is definitely not a sqlite database');
    await expect(app.interpretRequest(`restore ${corrupt}`)).rejects.toThrow();

    // The live database must still be usable.
    const after = await app.interpretRequest('show my tasks');
    expect(after.message).toContain('alpha task');
    expect(statSync(join(directory!, 'tasks.sqlite3')).size).toBeGreaterThan(0);
  });
});

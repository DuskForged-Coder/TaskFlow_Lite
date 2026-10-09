/**
 * VISIBLE acceptance test for T09 - JSONL export.
 *
 * Run with: corepack pnpm vitest run --config experiment/vitest.visible.config.ts
 * MUST FAIL on baseline.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskFlowApplication } from '../../src/app/application.js';
import { loadConfig } from '../../src/config/config.js';

describe('T09 JSONL export', () => {
  let directory: string | undefined;
  let application: TaskFlowApplication | undefined;

  afterEach(() => {
    application?.close();
    application = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function open(): TaskFlowApplication {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-T09-'));
    const config = loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
      TASKFLOW_AI_PROVIDER: 'none',
    });
    application = TaskFlowApplication.open(config);
    return application;
  }

  async function exportTo(app: TaskFlowApplication, name: string): Promise<string> {
    const target = join(directory!, name);
    const result = await app.interpretRequest(`export jsonl ${target}`);
    expect(result.status).toBe('done');
    return target;
  }

  function parseJsonl(path: string): Record<string, unknown>[] {
    const raw = readFileSync(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const lines = raw.split('\n').filter((line) => line.length > 0);
    return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('writes one JSON object per task and round-trips every business field', async () => {
    const app = open();
    await app.interpretRequest('create project University');
    await app.interpretRequest('add finish DBMS assignment tomorrow');
    await app.interpretRequest('assign finish DBMS assignment to University');
    await app.interpretRequest('estimate finish DBMS assignment for 90 minutes');
    await app.interpretRequest('set priority of finish DBMS assignment to high');

    const path = await exportTo(app, 'tasks.jsonl');
    const rows = parseJsonl(path);
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    for (const field of ['id', 'title', 'status', 'priority', 'projectId', 'createdAt', 'updatedAt', 'dueAt', 'completedAt', 'estimateMinutes', 'dependsOnTaskId', 'deletedAt']) {
      expect(row).toHaveProperty(field);
    }
    expect(row.title).toBe('finish DBMS assignment');
    expect(row.priority).toBe('high');
    expect(row.estimateMinutes).toBe(90);
    expect(row.projectId).toBeTruthy();
  });

  it('keeps every line parseable when task text contains newlines and quotes', async () => {
    const app = open();
    await app.interpretRequest('add tricky "quoted" task');

    const directoryPath = directory!;
    writeFileSync(join(directoryPath, 'marker.txt'), 'marker');

    const path = await exportTo(app, 'tricky.jsonl');
    const rows = parseJsonl(path);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.title)).toContain('tricky');
  });

  it('writes a valid empty file for an empty database', async () => {
    const app = open();
    const path = await exportTo(app, 'empty.jsonl');
    const rows = parseJsonl(path);
    expect(rows).toHaveLength(0);
  });

  it('reports a clean error for an unwritable path and leaves no partial file', async () => {
    const app = open();
    await app.interpretRequest('add something');
    const blocked = join(directory!, 'no-such-dir', 'out.jsonl');

    await expect(app.interpretRequest(`export jsonl ${blocked}`)).rejects.toThrow();
  });
});

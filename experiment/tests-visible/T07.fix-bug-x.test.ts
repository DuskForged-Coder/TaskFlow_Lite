/**
 * VISIBLE acceptance test for T07 - the ambiguous-task-resolution defect.
 *
 * This test PASSES on the unpatched baseline and FAILS once
 * experiment/seeds/bugX.patch is applied by `timer.sh start T07 <arm>`.
 * That is the whole point: it proves the seeded defect is present and that your
 * fix restores the documented safety behaviour.
 *
 * Run with: corepack pnpm vitest run --config experiment/vitest.visible.config.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskFlowApplication } from '../../src/app/application.js';
import { loadConfig } from '../../src/config/config.js';

describe('T07 ambiguous task resolution', () => {
  let directory: string | undefined;
  let application: TaskFlowApplication | undefined;

  afterEach(() => {
    application?.close();
    application = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function open(): TaskFlowApplication {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-T07-'));
    const config = loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
      TASKFLOW_AI_PROVIDER: 'none',
    });
    application = TaskFlowApplication.open(config);
    return application;
  }

  async function seedAmbiguity(app: TaskFlowApplication): Promise<void> {
    await app.interpretRequest('add write report chapter one');
    await app.interpretRequest('add write report chapter two');
  }

  /**
   * `delete` is confirmation-gated by design, so ambiguity may legitimately
   * surface either when the proposal is produced or when it is confirmed.
   * The contract that matters is: the wrong task is never touched.
   */
  async function expectRefused(app: TaskFlowApplication, command: string): Promise<void> {
    let caught: unknown;
    try {
      const result = await app.interpretRequest(command);
      if (result.status === 'confirmation') app.confirmRequest(result.intent, true);
      else throw new Error(`"${command}" unexpectedly completed with: ${result.message}`);
    } catch (error) {
      caught = error;
    }
    expect(caught, `"${command}" should have been refused`).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/more than one task/i);
  }

  it('refuses to delete when the query matches more than one task', async () => {
    const app = open();
    await seedAmbiguity(app);

    await expectRefused(app, 'delete write report');

    // Neither task may be touched.
    const remaining = await app.interpretRequest('show my tasks');
    expect(remaining.message).toContain('chapter one');
    expect(remaining.message).toContain('chapter two');
  });

  it('refuses other mutating commands on an ambiguous query', async () => {
    const app = open();
    await seedAmbiguity(app);

    await expectRefused(app, 'complete write report');
    await expectRefused(app, 'set priority of write report to high');

    const remaining = await app.interpretRequest('show my tasks');
    expect(remaining.message).toContain('chapter one');
    expect(remaining.message).toContain('chapter two');
  });

  it('still prefers an exact title match over partial matches', async () => {
    const app = open();
    await app.interpretRequest('add write report');
    await app.interpretRequest('add write report chapter one');

    const result = await app.interpretRequest('set priority of write report to urgent');
    expect(result.status).toBe('done');
    expect(result.message).toContain('write report');
  });

  it('still resolves a unique match normally', async () => {
    const app = open();
    await app.interpretRequest('add unique chore');

    const result = await app.interpretRequest('complete unique chore');
    expect(result.status).toBe('done');
  });

  it('still reports when nothing matches', async () => {
    const app = open();
    await app.interpretRequest('add something');

    // `delete` asks for confirmation before it resolves the task, so the
    // "not found" error surfaces when the confirmation is accepted.
    const proposal = await app.interpretRequest('delete nonexistent title');
    expect(proposal.status).toBe('confirmation');
    if (proposal.status !== 'confirmation') throw new Error('Expected a confirmation proposal');
    expect(() => app.confirmRequest(proposal.intent, true)).toThrow(/couldn't find a task/i);

    const after = await app.interpretRequest('show my tasks');
    expect(after.message).toContain('something');
  });
});

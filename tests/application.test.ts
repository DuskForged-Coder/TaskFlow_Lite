import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAx1Available, TaskFlowApplication } from '../src/app/application.js';
import { loadConfig } from '../src/config/config.js';

describe('TaskFlowApplication', () => {
  let directory: string | undefined;
  let application: TaskFlowApplication | undefined;

  afterEach(() => {
    application?.close();
    application = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function open(aiClient?: { generate: () => Promise<unknown> }): TaskFlowApplication {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-test-'));
    const config = loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
    });
    application = TaskFlowApplication.open(config, aiClient);
    return application;
  }

  it('executes local commands and persists the task through a restart', async () => {
    let app = open();
    await expect(app.interpretRequest('add persist this task'))
      .resolves.toMatchObject({ status: 'done', message: 'Created “persist this task”.' });
    app.close();

    app = TaskFlowApplication.open(loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory!, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
    }));
    application = app;
    await expect(app.interpretRequest('show my tasks'))
      .resolves.toMatchObject({ status: 'done', message: expect.stringContaining('persist this task') });
  });

  it('does not mutate before confirmation and supports refusing the proposal', async () => {
    const app = open({ generate: async () => ({ type: 'create_task', title: 'Review draft', confidence: 0.7 }) });
    const proposal = await app.interpretRequest('please create the review task');
    expect(proposal.status).toBe('confirmation');
    expect((await app.interpretRequest('show my tasks')).message).toContain('No tasks found');

    if (proposal.status !== 'confirmation') throw new Error('Expected a confirmation proposal');
    expect(app.confirmRequest(proposal.intent, false).message).toBe('No changes made.');
    expect((await app.interpretRequest('show my tasks')).message).toContain('No tasks found');
    expect(app.confirmRequest(proposal.intent, true).status).toBe('done');
    expect((await app.interpretRequest('show my tasks')).message).toContain('Review draft');
  });

  it('rejects low-confidence output without writing', async () => {
    const app = open({ generate: async () => ({ type: 'create_task', title: 'Guess', confidence: 0.2 }) });
    await expect(app.interpretRequest('maybe add a thing')).resolves.toMatchObject({ status: 'rejected' });
    expect((await app.interpretRequest('show my tasks')).message).toContain('No tasks found');
  });

  it('requires confirmation before deleting a matching task', async () => {
    const app = open();
    await app.interpretRequest('add remove me');
    const proposal = await app.interpretRequest('delete remove me');
    expect(proposal.status).toBe('confirmation');
    if (proposal.status !== 'confirmation') throw new Error('Expected a confirmation proposal');
    app.confirmRequest(proposal.intent, true);
    expect((await app.interpretRequest('show my tasks')).message).toContain('No tasks found');
  });

  it('creates projects, validates assignment, and shows project context', async () => {
    const app = open();
    await app.interpretRequest('add DBMS assignment');
    await expect(app.interpretRequest('create project University'))
      .resolves.toMatchObject({ status: 'done', message: 'Created project “University”.' });
    await expect(app.interpretRequest('assign DBMS assignment to University'))
      .resolves.toMatchObject({ status: 'done', message: 'Assigned “DBMS assignment” to “University”.' });
    await expect(app.interpretRequest('show my tasks'))
      .resolves.toMatchObject({ message: expect.stringContaining('University') });
    await expect(app.interpretRequest('assign DBMS assignment to Missing'))
      .rejects.toThrow('Project “Missing” was not found.');
  });

  it('restores a previously deleted task through the task service', async () => {
    const app = open();
    await app.interpretRequest('add recover me');
    const deleted = await app.interpretRequest('delete recover me');
    expect(deleted.status).toBe('confirmation');
    if (deleted.status !== 'confirmation') throw new Error('Expected a confirmation proposal');
    app.confirmRequest(deleted.intent, true);
    await expect(app.interpretRequest('restore recover me'))
      .resolves.toMatchObject({ status: 'done', message: 'Restored “recover me”.' });
  });

  it('undoes a task update through the offline command vocabulary', async () => {
    const app = open();
    await app.interpretRequest('add undo me');
    await app.interpretRequest('set priority of undo me to urgent');
    await expect(app.interpretRequest('undo undo me'))
      .resolves.toMatchObject({ status: 'done', message: 'Undid the last change to “undo me”.' });
    await expect(app.interpretRequest('show my tasks'))
      .resolves.toMatchObject({ message: expect.stringContaining('[normal]') });
  });

  it('does not execute an AI result that arrives after request cancellation', async () => {
    let resolveIntent: ((value: unknown) => void) | undefined;
    const app = open({ generate: () => new Promise((resolve) => { resolveIntent = resolve; }) });
    const controller = new AbortController();
    const pending = app.interpretRequest('make a task for later', controller.signal);
    await Promise.resolve();
    controller.abort();
    resolveIntent?.({ type: 'create_task', title: 'Late result', confidence: 0.99 });

    await expect(pending).rejects.toThrow('Request cancelled.');
    await expect(app.interpretRequest('show my tasks')).resolves.toMatchObject({ message: expect.stringContaining('No tasks found') });
  });

  it('refuses new requests once shutdown stops acceptance', async () => {
    const app = open();
    app.stopAccepting();
    await expect(app.interpretRequest('show my tasks')).rejects.toThrow('TaskFlow is shutting down');
  });

  it('proposes an explainable plan, waits for approval, and verifies persisted schedule blocks', async () => {
    let app = open();
    await app.interpretRequest('create project College');
    await app.interpretRequest('add prepare DBMS submission');
    await app.interpretRequest('assign prepare DBMS submission to College');
    await app.interpretRequest('estimate prepare DBMS submission for 45 minutes');
    const proposal = await app.interpretRequest('plan the next 2 hours');
    expect(proposal.status).toBe('confirmation');
    if (proposal.status !== 'confirmation' || !proposal.plan) throw new Error('Expected a day plan proposal');
    expect(proposal.message).toContain('TODAY\'S PROPOSED PLAN');
    expect(proposal.message).toContain('Work 45m');
    expect(proposal.message).toContain('Buffer 1h 15m');
    expect(proposal.message).toContain('College');
    expect(proposal.message).toContain('No calendar is connected');
    expect(app.scheduleForPlan(proposal.plan.id)).toHaveLength(0);

    const applied = app.confirmRequest(proposal.intent, true, proposal.plan);
    expect(applied.message).toContain('Plan applied and verified');
    expect(app.scheduleForPlan(proposal.plan.id).filter((block) => block.kind === 'work')).toHaveLength(1);
    expect(app.scheduleForToday()).toHaveLength(1);

    app.close();
    app = TaskFlowApplication.open(loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory!, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
    }));
    application = app;
    expect(app.scheduleForPlan(proposal.plan.id)).toHaveLength(1);
  });

  it('does not save schedule blocks when a proposed plan is declined', async () => {
    const app = open();
    await app.interpretRequest('add finish review');
    await app.interpretRequest('estimate finish review for 30 minutes');
    const proposal = await app.interpretRequest('plan my evening');
    if (proposal.status !== 'confirmation' || !proposal.plan) throw new Error('Expected a day plan proposal');
    expect(app.confirmRequest(proposal.intent, false, proposal.plan).message).toBe('No changes made.');
    expect(app.scheduleForPlan(proposal.plan.id)).toHaveLength(0);
  });

  it('reports the AI connection state without exposing any key material', () => {
    // An explicit empty store keeps this independent of whatever key the
    // developer's own keychain happens to hold. With no Gemini key the status
    // reflects whichever local fallback is available on this machine.
    const emptyStore = {
      getGeminiApiKey: () => undefined,
      setGeminiApiKey: () => undefined,
      deleteGeminiApiKey: () => false,
    };
    directory = mkdtempSync(join(tmpdir(), 'taskflow-test-'));
    const app = TaskFlowApplication.open(loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
    }), undefined, emptyStore);
    application = app;

    // No Gemini key is configured, so the source can never be a credential.
    expect(app.aiStatus.source).not.toBe('keychain');
    expect(app.aiStatus.source).not.toBe('environment');
    // The status object describes the connection but never carries a key.
    expect(JSON.stringify(app.aiStatus)).not.toContain('AIza');
  });

  it('falls back to the local AX 1 runtime when no Gemini key is configured', () => {
    const emptyStore = {
      getGeminiApiKey: () => undefined,
      setGeminiApiKey: () => undefined,
      deleteGeminiApiKey: () => false,
    };
    directory = mkdtempSync(join(tmpdir(), 'taskflow-test-'));
    const app = TaskFlowApplication.open(loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
      // Point at this machine's own node binary so the probe deterministically
      // succeeds without depending on ax1 being installed.
      TASKFLOW_AI_PROVIDER: 'ax1',
      TASKFLOW_AX1_BINARY: process.execPath,
    }), undefined, emptyStore);
    application = app;

    expect(app.aiStatus).toMatchObject({ connected: true, source: 'ax1-local' });
  });

  it('runs with no AI at all when the provider is none', () => {
    const emptyStore = {
      getGeminiApiKey: () => undefined,
      setGeminiApiKey: () => undefined,
      deleteGeminiApiKey: () => false,
    };
    directory = mkdtempSync(join(tmpdir(), 'taskflow-test-'));
    const app = TaskFlowApplication.open(loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
      TASKFLOW_AI_PROVIDER: 'none',
    }), undefined, emptyStore);
    application = app;

    expect(app.aiStatus).toMatchObject({ connected: false, source: 'none' });
  });

  it('resolves the ax1 binary on PATH and rejects an unknown one', () => {
    // The test runner's own PATH contains node, so a real executable resolves.
    expect(isAx1Available(process.execPath)).toBe(true);
    expect(isAx1Available('definitely-not-a-real-binary-xyz')).toBe(false);
    expect(isAx1Available('/nonexistent/path/to/binary')).toBe(false);
  });

  it('reports an environment-provided key as connected', () => {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-test-'));
    const app = TaskFlowApplication.open(loadConfig({
      TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'),
      TASKFLOW_TIMEZONE: 'UTC',
      GEMINI_API_KEY: 'AIzaEnvironmentKeyValue000000000000',
    }));
    application = app;
    expect(app.aiStatus).toMatchObject({ connected: true, source: 'environment' });
    // The status object describes the connection but never carries the key.
    expect(JSON.stringify(app.aiStatus)).not.toContain('AIza');
  });

  it('requires confirmation for every plan and never applies one implicitly', async () => {
    const app = open();
    await app.interpretRequest('add write report');
    await app.interpretRequest('estimate write report for 60 minutes');

    const proposal = await app.interpretRequest('plan my day');
    expect(proposal.status).toBe('confirmation');
    if (proposal.status !== 'confirmation' || !proposal.plan) throw new Error('Expected a proposal');

    // The proposal alone must leave the database untouched.
    expect(app.scheduleForToday()).toHaveLength(0);
    expect(app.scheduleForPlan(proposal.plan.id)).toHaveLength(0);
    expect(proposal.message).toContain('Nothing has been changed');

    // Only the explicit approval path writes anything.
    app.confirmRequest(proposal.intent, true, proposal.plan);
    expect(app.scheduleForToday().length).toBeGreaterThan(0);
  });

  it('regenerates a proposal on revision without applying anything', async () => {
    // This scenario is time-of-day sensitive: "before 11am" is resolved against
    // the current clock, and after 11am the chrono parser resolves it to the
    // following day, which pushes the revised plan past the end of the window
    // and yields no blocks at all. The application builds its own
    // DayPlanService, so the clock is pinned here instead, by faking only Date
    // so that new Date()/Date.now() report a fixed morning instant. No
    // production code is changed and no real timer is faked.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T08:00:00.000Z'));
    try {
      const app = open();
      await app.interpretRequest('add DBMS assignment');
      await app.interpretRequest('estimate DBMS assignment for 30 minutes');
      const first = await app.interpretRequest('plan the next 16 hours');
      if (first.status !== 'confirmation' || !first.plan) throw new Error('Expected a proposal');
      const firstStart = first.plan.blocks[0]?.startsAt;
      expect(firstStart).toBeDefined();

      const revised = await app.interpretRequest("don't schedule anything before 11am");
      expect(revised.status).toBe('confirmation');
      if (revised.status !== 'confirmation' || !revised.plan) throw new Error('Expected a revised proposal');

      // A new plan id and a later start, and still nothing persisted.
      expect(revised.plan.id).not.toBe(first.plan.id);
      expect(Date.parse(revised.plan.blocks[0]!.startsAt)).toBeGreaterThan(Date.parse(firstStart!));
      expect(app.scheduleForToday()).toHaveLength(0);
      expect(app.scheduleForPlan(revised.plan.id)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records a dependency only after explicit confirmation', async () => {
    const app = open();
    await app.interpretRequest('add research sources');
    await app.interpretRequest('add write the section');

    const proposal = await app.interpretRequest('write the section depends on research sources');
    expect(proposal.status).toBe('confirmation');
    if (proposal.status !== 'confirmation') throw new Error('Expected a confirmation');
    expect(proposal.message).toContain('Type y to confirm');
    // Declining leaves the relationship unrecorded.
    expect(app.confirmRequest(proposal.intent, false).message).toBe('No changes made.');

    const accepted = await app.interpretRequest('write the section depends on research sources');
    if (accepted.status !== 'confirmation') throw new Error('Expected a confirmation');
    expect(app.confirmRequest(accepted.intent, true).message).toContain('now waits for');
  });

  it('surfaces assumptions for tasks with no estimate and persists them only on approval', async () => {
    const app = open();
    await app.interpretRequest('add read the paper');
    const proposal = await app.interpretRequest('plan the next 3 hours');
    if (proposal.status !== 'confirmation' || !proposal.plan) throw new Error('Expected a proposal');

    expect(proposal.plan.assumptions).toHaveLength(1);
    expect(proposal.message).toContain('Assumptions:');
    expect(proposal.message).toContain('read the paper');

    const listed = await app.interpretRequest('show my tasks');
    expect(listed.message).toContain('read the paper');

    const applied = app.confirmRequest(proposal.intent, true, proposal.plan);
    expect(applied.message).toContain('assumed duration');
  });

  it('reports an over-capacity workload instead of silently dropping work', async () => {
    const app = open();
    await app.interpretRequest('add enormous task');
    await app.interpretRequest('estimate enormous task for 600 minutes');
    const proposal = await app.interpretRequest('plan the next 2 hours');
    if (proposal.status !== 'confirmation' || !proposal.plan) throw new Error('Expected a proposal');

    expect(proposal.plan.requiredMinutes).toBe(600);
    expect(proposal.message).toContain('Trade-offs:');
    expect(proposal.message).toContain('remain unscheduled');
    expect(app.scheduleForToday()).toHaveLength(0);
  });

  it('rejects applying a plan after the underlying task changed', async () => {
    const app = open();
    await app.interpretRequest('add build feature');
    await app.interpretRequest('estimate build feature for 45 minutes');
    const proposal = await app.interpretRequest('plan the next 2 hours');
    if (proposal.status !== 'confirmation' || !proposal.plan) throw new Error('Expected a proposal');

    // A concurrent edit invalidates the version the plan was built against.
    await app.interpretRequest('set priority of build feature to urgent');
    expect(() => app.confirmRequest(proposal.intent, true, proposal.plan)).toThrow(/changed after the plan was proposed/);
    expect(app.scheduleForToday()).toHaveLength(0);
  });
});
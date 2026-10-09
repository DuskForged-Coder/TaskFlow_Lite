import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DayPlanService } from '../src/core/agent/dayPlanService.js';
import { SqliteTaskRepository } from '../src/db/repositories/sqliteTaskRepository.js';
import { SqliteScheduleBlockRepository } from '../src/db/repositories/sqliteScheduleBlockRepository.js';
import { runMigrations } from '../src/db/migrations.js';
import { TaskService } from '../src/core/tasks/taskService.js';
import { DatabaseError, UserError } from '../src/core/errors.js';

describe('DayPlanService', () => {
  let database: Database.Database;
  let tasks: TaskService;
  let schedules: SqliteScheduleBlockRepository;
  let planner: DayPlanService;
  let nextId: number;
  const now = new Date('2026-09-30T09:00:00.000Z');

  beforeEach(() => {
    database = new Database(':memory:');
    runMigrations(database);
    nextId = 0;
    tasks = new TaskService(new SqliteTaskRepository(database), () => now, () => `task-${++nextId}`);
    schedules = new SqliteScheduleBlockRepository(database);
    planner = new DayPlanService(tasks, schedules, 'UTC', () => now, () => `plan-block-${++nextId}`);
  });

  afterEach(() => database.close());

  it('proposes explainable deterministic work blocks without writing before approval', () => {
    const overdue = tasks.createTask({ title: 'Overdue report', priority: 'normal', dueAt: '2026-09-29T12:00:00Z', estimateMinutes: 40 });
    tasks.createTask({ title: 'Urgent cleanup', priority: 'urgent', estimateMinutes: 30 });
    tasks.createTask({ title: 'Unestimated reading' });

    const plan = planner.propose(120);
    expect(plan.blocks.filter((block) => block.kind === 'work').map((block) => block.taskId))
      .toEqual([overdue.id, 'task-2', 'task-2']);
    expect(plan.blocks.map((block) => block.kind)).toEqual(['work', 'work', 'break', 'work']);
    expect(plan.blocks[0]?.reason).toContain('Overdue');
    // An unestimated task is no longer dropped: the planner assumes a duration
    // and reports it, and this window is too small to fit the assumption.
    expect(plan.assumptions).toHaveLength(1);
    expect(plan.assumptions[0]).toMatchObject({ taskId: 'task-3', title: 'Unestimated reading', assumedMinutes: 60 });
    expect(plan.assumptions[0]?.basis).toContain('assumes 1h');
    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'insufficient_time', title: 'Unestimated reading' }),
      expect.objectContaining({ kind: 'over_capacity' }),
    ]));
    expect(plan.omittedTasks).toContainEqual({ title: 'Unestimated reading', reason: 'The 1h estimate does not fit in the remaining window.' });
    expect(schedules.listByPlan(plan.id)).toHaveLength(0);
  });

  it('splits long estimates with breaks and persists only when applied', () => {
    tasks.createTask({ title: 'Prepare examination', estimateMinutes: 90 });
    const plan = planner.propose(120);
    expect(plan.blocks.map((block) => block.kind)).toEqual(['work', 'break', 'work']);
    expect(plan.workMinutes).toBe(90);
    expect(plan.breakMinutes).toBe(10);
    expect(schedules.listByPlan(plan.id)).toHaveLength(0);

    const saved = planner.apply(plan);
    expect(saved).toHaveLength(3);
    expect(schedules.listByPlan(plan.id)).toHaveLength(3);
    expect(planner.scheduleForToday()).toHaveLength(3);
  });

  it('rejects a plan if a task changed after proposal without writing any blocks', () => {
    const task = tasks.createTask({ title: 'Build feature', estimateMinutes: 60 });
    const plan = planner.propose(120);
    tasks.setPriority(task.id, 'urgent');

    expect(() => planner.apply(plan)).toThrow(UserError);
    expect(schedules.listByPlan(plan.id)).toHaveLength(0);
  });

  it('rejects overlapping existing schedule blocks and invalid planning windows', () => {
    tasks.createTask({ title: 'Write tests', estimateMinutes: 45 });
    tasks.createTask({ title: 'Plan review', estimateMinutes: 30 });
    const first = planner.propose(45);
    planner.apply(first);
    const second = planner.propose(120);
    expect(second.blocks[0]?.taskId).toBe('task-2');
    expect(Date.parse(second.blocks[0]!.startsAt)).toBeGreaterThanOrEqual(Date.parse(first.blocks[first.blocks.length - 1]!.endsAt));
    expect(() => planner.apply(second)).not.toThrow();
    expect(() => planner.propose(10)).toThrow(UserError);
  });

  it('schedules a prerequisite before the task that depends on it', () => {
    const research = tasks.createTask({ title: 'Research sources', estimateMinutes: 30 });
    const writing = tasks.createTask({ title: 'Write section', estimateMinutes: 30 });
    tasks.setDependency(writing.id, research.id);

    const plan = planner.propose(120);
    const order = plan.blocks.filter((block) => block.kind === 'work').map((block) => block.taskId);
    // "Write section" is more urgent, so ranking alone would place it first.
    expect(order.indexOf(research.id)).toBeLessThan(order.indexOf(writing.id));
  });

  it('refuses to schedule a dependent whose prerequisite cannot fit', () => {
    const research = tasks.createTask({ title: 'Research sources', estimateMinutes: 90, priority: 'urgent' });
    const writing = tasks.createTask({ title: 'Write section', estimateMinutes: 60 });
    tasks.setDependency(writing.id, research.id);

    // Only the 90-minute prerequisite fits; the dependent must not be squeezed in.
    const plan = planner.propose(90);
    expect(plan.blocks.some((block) => block.taskId === writing.id)).toBe(false);
    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'blocked_by_dependency', title: 'Write section' }),
    ]));
    expect(plan.omittedTasks).toContainEqual({ title: 'Write section', reason: 'Waiting on “Research sources”.' });
  });

  it('reports the workload shortfall instead of overfilling the window', () => {
    tasks.createTask({ title: 'Huge task', estimateMinutes: 600 });
    tasks.createTask({ title: 'Another huge task', estimateMinutes: 600 });

    const plan = planner.propose(120);
    const capacity = plan.conflicts.find((conflict) => conflict.kind === 'over_capacity');
    expect(capacity).toBeDefined();
    expect(capacity?.detail).toContain('20h');
    expect(plan.requiredMinutes).toBe(1200);
    expect(plan.workMinutes).toBeLessThan(plan.requiredMinutes);
    // Buffer is preserved rather than consumed by extra work.
    expect(plan.bufferMinutes).toBeGreaterThan(0);
  });

  it('records an assumed duration and persists it only after approval', () => {
    const unestimated = tasks.createTask({ title: 'Read chapter' });
    const plan = planner.propose(120);

    expect(plan.assumptions).toHaveLength(1);
    expect(plan.assumptions[0]?.taskId).toBe(unestimated.id);
    expect(plan.proposedChanges).toContainEqual({
      kind: 'set_estimate',
      taskId: unestimated.id,
      title: 'Read chapter',
      estimateMinutes: 60,
    });
    // Planning alone must not write the estimate.
    expect(tasks.getTask(unestimated.id)?.estimateMinutes).toBeNull();

    planner.apply(plan);
    expect(tasks.getTask(unestimated.id)?.estimateMinutes).toBe(60);
  });

  it('keeps user-described commitments clear and counts them against the window', () => {
    tasks.createTask({ title: 'Study', estimateMinutes: 60 });
    const plan = planner.propose(120, {
      busyIntervals: [{ label: 'class', startsAt: '2026-09-30T10:00:00.000Z', endsAt: '2026-09-30T11:00:00.000Z' }],
    });

    expect(plan.committedMinutes).toBe(60);
    for (const block of plan.blocks) {
      const startsBeforeClassEnd = Date.parse(block.startsAt) < Date.parse('2026-09-30T11:00:00.000Z');
      const endsAfterClassStart = Date.parse(block.endsAt) > Date.parse('2026-09-30T10:00:00.000Z');
      expect(startsBeforeClassEnd && endsAfterClassStart).toBe(false);
    }
  });

  it('honours a not-before floor supplied while revising', () => {
    tasks.createTask({ title: 'Deep work', estimateMinutes: 60 });
    // The floor starts at 10:00, so the window must extend past it to fit work.
    const plan = planner.propose(240, { notBefore: '2026-09-30T10:00:00.000Z' });
    expect(plan.blocks.length).toBeGreaterThan(0);
    expect(Date.parse(plan.blocks[0]!.startsAt)).toBeGreaterThanOrEqual(Date.parse('2026-09-30T10:00:00.000Z'));
  });

  it('grants extra minutes to a focused task without touching the stored estimate', () => {
    const target = tasks.createTask({ title: 'DBMS', estimateMinutes: 30 });
    const other = tasks.createTask({ title: 'Other', estimateMinutes: 30 });

    const plan = planner.propose(240, { extraMinutesByTaskId: { [target.id]: 60 } });
    const targetMinutes = plan.blocks
      .filter((block) => block.taskId === target.id)
      .reduce((total, block) => total + (Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60_000, 0);
    expect(targetMinutes).toBe(90);
    expect(plan.assumptions).toHaveLength(0);
    // The proposal inflates time; only the database is authoritative.
    expect(tasks.getTask(target.id)?.estimateMinutes).toBe(30);
    expect(tasks.getTask(other.id)?.estimateMinutes).toBe(30);
  });

  it('handles an empty task list without inventing work', () => {
    const plan = planner.propose(120);
    expect(plan.blocks).toEqual([]);
    expect(plan.proposedChanges).toEqual([]);
    expect(plan.assumptions).toEqual([]);
    expect(plan.requiredMinutes).toBe(0);
  });

  it('rejects a circular dependency at the service boundary', () => {
    const first = tasks.createTask({ title: 'First' });
    const second = tasks.createTask({ title: 'Second' });
    tasks.setDependency(second.id, first.id);
    expect(() => tasks.setDependency(first.id, second.id)).toThrow(/circular/);
    expect(() => tasks.setDependency(first.id, first.id)).toThrow(/itself/);
  });

  it('uses a SQLite trigger to reject overlapping inserts even when a caller bypasses planner checks', () => {
    tasks.createTask({ title: 'Make progress', estimateMinutes: 30 });
    const plan = planner.propose(60);
    const saved = planner.apply(plan);
    let caught: unknown;
    try {
      schedules.createPlan('bypass-plan', [{
        id: 'overlap-attempt',
        planId: 'bypass-plan',
        taskId: null,
        label: 'Conflicting block',
        kind: 'break',
        startsAt: saved[0]!.startsAt,
        endsAt: saved[0]!.endsAt,
        createdAt: now.toISOString(),
      }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as DatabaseError).cause).toMatchObject({ message: 'schedule block overlaps an existing block' });
    expect(schedules.listByPlan('bypass-plan')).toHaveLength(0);
  });
});
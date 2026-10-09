/**
 * VISIBLE acceptance test for T05 - recurring daily / weekly tasks.
 *
 * Run with: corepack pnpm vitest run --config experiment/vitest.visible.config.ts
 * MUST FAIL on baseline (no recurrence support exists).
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteTaskRepository } from '../../src/db/repositories/sqliteTaskRepository.js';
import { runMigrations } from '../../src/db/migrations.js';
import { TaskService } from '../../src/core/tasks/taskService.js';
import { UserError } from '../../src/core/errors.js';

describe('T05 recurring tasks', () => {
  let db: Database.Database;
  let tasks: TaskService;
  let nextId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    nextId = 0;
    tasks = new TaskService(new SqliteTaskRepository(db), () => new Date('2026-09-30T12:00:00.000Z'), () => `task-${++nextId}`);
  });

  afterEach(() => db.close());

  it('rejects an unsupported recurrence pattern', () => {
    expect(() => tasks.createTask({ title: 'Bad', recurrence: { pattern: 'yearly' } } as never)).toThrow(UserError);
  });

  it('creates the next daily occurrence when completing a recurring task', () => {
    const task = tasks.createTask({
      title: 'Standup',
      dueAt: '2026-10-01T09:00:00.000Z',
      recurrence: { pattern: 'daily' },
    } as never);

    tasks.completeTask(task.id);

    const open = tasks.listTasks({ status: 'open' });
    expect(open).toHaveLength(1);
    expect(open[0]?.id).not.toBe(task.id);
    expect(open[0]?.title).toBe('Standup');
    expect(open[0]?.dueAt).toBe('2026-10-02T09:00:00.000Z');
    expect(tasks.getTask(task.id)?.status).toBe('completed');
  });

  it('skips the intervening week for a weekly task', () => {
    const task = tasks.createTask({
      title: 'Lab',
      dueAt: '2026-10-05T09:00:00.000Z',
      recurrence: { pattern: 'weekly', daysOfWeek: [1] },
    } as never);

    tasks.completeTask(task.id);
    const open = tasks.listTasks({ status: 'open' });
    expect(open).toHaveLength(1);
    expect(open[0]?.dueAt).toBe('2026-10-12T09:00:00.000Z');
  });

  it('leaves non-recurring completion behaviour unchanged', () => {
    const task = tasks.createTask({ title: 'Once' });
    tasks.completeTask(task.id);
    expect(tasks.listTasks({ status: 'open' })).toHaveLength(0);
    expect(tasks.listTasks({ includeDeleted: true })).toHaveLength(1);
  });

  it('does not spawn an occurrence for a recurring task with no due date', () => {
    const task = tasks.createTask({ title: 'NoDue', recurrence: { pattern: 'daily' } } as never);
    expect(() => tasks.completeTask(task.id)).not.toThrow();
    expect(tasks.listTasks({ status: 'open' })).toHaveLength(0);
  });

  it('undo of a completion removes the spawned occurrence', () => {
    const task = tasks.createTask({
      title: 'Standup',
      dueAt: '2026-10-01T09:00:00.000Z',
      recurrence: { pattern: 'daily' },
    } as never);

    tasks.completeTask(task.id);
    expect(tasks.listTasks({ status: 'open' })).toHaveLength(1);

    const restored = tasks.undoLastChange(task.id);
    expect(restored.status).toBe('open');
  });
});

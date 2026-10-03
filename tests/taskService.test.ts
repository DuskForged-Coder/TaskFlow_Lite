import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteTaskRepository } from '../src/db/repositories/sqliteTaskRepository.js';
import { runMigrations } from '../src/db/migrations.js';
import { TaskService } from '../src/core/tasks/taskService.js';
import { TaskConflictError } from '../src/core/tasks/taskErrors.js';
import { UserError } from '../src/core/errors.js';

describe('TaskService with SQLite', () => {
  let db: Database.Database;
  let tasks: TaskService;
  let currentTime: Date;
  let nextId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    currentTime = new Date('2026-09-30T12:00:00.000Z');
    nextId = 0;
    tasks = new TaskService(new SqliteTaskRepository(db), () => currentTime, () => `task-${++nextId}`);
  });

  afterEach(() => db.close());

  it('creates, edits, completes, and reopens a task with incrementing versions', () => {
    const created = tasks.createTask({ title: '  Finish report  ', priority: 'high' });
    expect(created.title).toBe('Finish report');
    expect(created.version).toBe(1);

    const updated = tasks.updateTask(created.id, { title: 'Submit report' }, created.version);
    expect(updated.version).toBe(2);
    expect(updated.title).toBe('Submit report');

    const completed = tasks.completeTask(created.id, updated.version);
    expect(completed.status).toBe('completed');
    expect(completed.version).toBe(3);

    const reopened = tasks.reopenTask(created.id, completed.version);
    expect(reopened.status).toBe('open');
    expect(reopened.completedAt).toBeNull();
  });

  it('soft-deletes and restores tasks through service operations', () => {
    const created = tasks.createTask({ title: 'Archive notes' });
    tasks.deleteTask(created.id, created.version);
    expect(tasks.listTasks()).toHaveLength(0);
    expect(tasks.listTasks({ includeDeleted: true })).toHaveLength(1);
    expect(tasks.restoreTask(created.id).deletedAt).toBeNull();
  });

  it('rejects a stale version without overwriting the newer change', () => {
    const created = tasks.createTask({ title: 'Write review' });
    tasks.updateTask(created.id, { title: 'Review pull request' }, created.version);

    expect(() => tasks.updateTask(created.id, { title: 'Old title' }, created.version))
      .toThrow(TaskConflictError);
    expect(tasks.listTasks()[0]?.title).toBe('Review pull request');
  });

  it('undoes a change and rejects undo when task data changed afterward', () => {
    const created = tasks.createTask({ title: 'Prepare slides' });
    tasks.updateTask(created.id, { title: 'Prepare demo slides' }, created.version);
    expect(tasks.undoLastChange(created.id).title).toBe('Prepare slides');

    db.prepare("UPDATE tasks SET priority = 'urgent', version = version + 1 WHERE id = ?").run(created.id);
    expect(() => tasks.undoLastChange(created.id)).toThrow(TaskConflictError);
    expect(tasks.listTasks()[0]?.priority).toBe('urgent');
  });

  it('filters searches and recommends overdue work deterministically', () => {
    tasks.createTask({ title: 'Read notes', dueAt: '2026-09-29T10:00:00Z' });
    tasks.createTask({ title: 'Prepare demo', priority: 'urgent', dueAt: '2026-10-04T10:00:00Z' });

    expect(tasks.searchTasks('demo')).toHaveLength(1);
    expect(tasks.overdueTasks()).toHaveLength(1);
    expect(tasks.recommendNextTask()?.task.title).toBe('Read notes');
  });

  it('rejects invalid dates and unknown projects before writing', () => {
    expect(() => tasks.createTask({ title: 'Invalid date', dueAt: '2026-02-30T09:00:00Z' })).toThrow(UserError);
    expect(() => tasks.createTask({ title: 'Unknown project', projectId: 'missing-project' })).toThrow(UserError);
    expect(tasks.listTasks()).toHaveLength(0);
  });

  it('stores a validated estimate and includes estimate changes in undo history', () => {
    const task = tasks.createTask({ title: 'Prepare notes', estimateMinutes: 45 });
    expect(task.estimateMinutes).toBe(45);
    const updated = tasks.setEstimate(task.id, 90);
    expect(updated.estimateMinutes).toBe(90);
    expect(tasks.undoLastChange(task.id).estimateMinutes).toBe(45);
    expect(() => tasks.setEstimate(task.id, 0)).toThrow(UserError);
  });
});
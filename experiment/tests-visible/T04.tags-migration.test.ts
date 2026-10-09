/**
 * VISIBLE acceptance test for T04 - task tags field + migration.
 *
 * Run with: corepack pnpm vitest run --config experiment/vitest.visible.config.ts
 * MUST FAIL on baseline (there is no `tags` column and no migration 5).
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteTaskRepository } from '../../src/db/repositories/sqliteTaskRepository.js';
import { runMigrations } from '../../src/db/migrations.js';
import { TaskService } from '../../src/core/tasks/taskService.js';
import { UserError } from '../../src/core/errors.js';

describe('T04 tags field and migration', () => {
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

  it('advances the schema and adds a tags column', () => {
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(5);
    const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('tags');
  });

  it('normalises tags on write: trimmed, lower-cased, de-duplicated, order kept', () => {
    const created = tasks.createTask({ title: 'Report', tags: [' Exam ', 'exam', 'URGENT'] } as never);
    expect(tasks.getTask(created.id)?.tags).toEqual(['exam', 'urgent']);
  });

  it('discards empty tags', () => {
    const created = tasks.createTask({ title: 'Report', tags: ['exam', '', '   '] } as never);
    expect(tasks.getTask(created.id)?.tags).toEqual(['exam']);
  });

  it('replaces tags on update and bumps the version', () => {
    const created = tasks.createTask({ title: 'Report', tags: ['exam'] } as never);
    const updated = tasks.updateTask(created.id, { tags: ['revision'] } as never);
    expect(updated.version).toBe(2);
    expect(tasks.getTask(created.id)?.tags).toEqual(['revision']);
  });

  it('enforces the tag count and length limits', () => {
    const many = Array.from({ length: 11 }, (_, index) => `tag${index}`);
    expect(() => tasks.createTask({ title: 'Many', tags: many } as never)).toThrow(UserError);
    expect(() => tasks.createTask({ title: 'Long', tags: ['x'.repeat(41)] } as never)).toThrow(UserError);
  });

  it('includes tags in undo history', () => {
    const created = tasks.createTask({ title: 'Report', tags: ['exam'] } as never);
    tasks.updateTask(created.id, { tags: ['revision'] } as never);
    expect(tasks.undoLastChange(created.id).tags).toEqual(['exam']);
  });
});

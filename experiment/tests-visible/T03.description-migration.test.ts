/**
 * VISIBLE acceptance test for T03 - task description field + migration.
 *
 * Run with: corepack pnpm vitest run --config experiment/vitest.visible.config.ts
 * MUST FAIL on baseline (there is no `notes` column and no migration 5).
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteTaskRepository } from '../../src/db/repositories/sqliteTaskRepository.js';
import { runMigrations } from '../../src/db/migrations.js';
import { TaskService } from '../../src/core/tasks/taskService.js';
import { UserError } from '../../src/core/errors.js';

describe('T03 description field and migration', () => {
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

  it('advances the schema and adds a notes column', () => {
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(5);
    const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('notes');
  });

  it('stores, updates and validates the description', () => {
    const created = tasks.createTask({ title: 'Report', notes: 'check the appendix' } as never);
    expect(tasks.getTask(created.id)?.notes).toBe('check the appendix');

    const updated = tasks.updateTask(created.id, { notes: 'now the cover page' } as never);
    expect(updated.version).toBe(2);
    expect(tasks.getTask(created.id)?.notes).toBe('now the cover page');
  });

  it('rejects an over-long description and terminal control characters', () => {
    expect(() => tasks.createTask({ title: 'Long', notes: 'x'.repeat(201) } as never)).toThrow(UserError);
    expect(() => tasks.createTask({ title: 'Escape', notes: 'bad[31m' } as never)).toThrow(UserError);
  });

  it('includes the description in undo history', () => {
    const created = tasks.createTask({ title: 'Report', notes: 'first' } as never);
    tasks.updateTask(created.id, { notes: 'second' } as never);
    expect(tasks.undoLastChange(created.id).notes).toBe('first');
  });
});

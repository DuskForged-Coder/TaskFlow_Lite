import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseError, toUserMessage } from '../src/core/errors.js';
import { SqliteConnection } from '../src/db/connection.js';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { formatErrorDetails } from '../src/utils/logging.js';
import { SqliteTaskRepository } from '../src/db/repositories/sqliteTaskRepository.js';

describe('SqliteConnection', () => {
  let directory: string | undefined;
  let connection: SqliteConnection | undefined;

  afterEach(() => {
    connection?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
    connection = undefined;
  });

  it('opens, tracks state, restricts file permissions, closes, and reopens', () => {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-db-'));
    const path = join(directory, 'tasks.sqlite3');
    connection = new SqliteConnection(path);
    expect(connection.state).toBe('closed');
    expect(connection.open().prepare('SELECT 7 AS result').get()).toEqual({ result: 7 });
    expect(connection.state).toBe('open');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    connection.close();
    connection.close();
    expect(connection.state).toBe('closed');
    expect(connection.open().prepare('SELECT 8 AS result').get()).toEqual({ result: 8 });
    expect(connection.open().pragma('user_version', { simple: true })).toBe(4);
    expect(connection.open().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get())
      .toEqual({ name: 'tasks' });
  });

  it('creates spaced nested directories securely and applies migrations on the first open', () => {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-db-'));
    const parent = join(directory, 'nested folder', 'TaskFlow data');
    const path = join(parent, 'tasks.sqlite3');
    connection = new SqliteConnection(path);
    const db = connection.open();
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    expect(statSync(parent).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_history'").get())
      .toEqual({ name: 'task_history' });
  });

  it('preserves EEXIST when a parent component is a regular file', () => {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-db-'));
    const file = join(directory, 'not-a-directory');
    writeFileSync(file, 'x');
    connection = new SqliteConnection(join(file, 'tasks.sqlite3'));
    let caught: unknown;
    try {
      connection.open();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as DatabaseError).cause).toMatchObject({ code: 'EEXIST' });
    expect(formatErrorDetails(caught)).toContain('EEXIST');
    expect(toUserMessage(caught)).toBe('Could not open the local TaskFlow database.');
    expect(connection.state).toBe('closed');
  });

  it('rejects a malformed existing database and retains SQLITE_NOTADB', () => {
    directory = mkdtempSync(join(tmpdir(), 'taskflow-db-'));
    const path = join(directory, 'malformed.sqlite3');
    writeFileSync(path, 'not a sqlite database');
    connection = new SqliteConnection(path);
    let caught: unknown;
    try {
      connection.open();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as DatabaseError).cause).toMatchObject({ code: 'SQLITE_NOTADB' });
    expect(connection.state).toBe('closed');
  });

  it('applies schema migrations once and rejects databases from a newer version', () => {
    const fresh = new Database(':memory:');
    runMigrations(fresh);
    expect(fresh.pragma('user_version', { simple: true })).toBe(4);
    runMigrations(fresh);
    fresh.close();

    const future = new Database(':memory:');
    future.pragma('user_version = 99');
    expect(() => runMigrations(future)).toThrow('newer application version');
    future.close();
  });

  it('rolls back a failed schema migration without advancing user_version', () => {
    const database = new Database(':memory:');
    database.exec('CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE tasks (id TEXT PRIMARY KEY);');
    expect(() => runMigrations(database)).toThrow(DatabaseError);
    expect(database.pragma('user_version', { simple: true })).toBe(0);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_history'").get())
      .toBeUndefined();
    database.close();
  });

  it('upgrades an existing v1 database and preserves its task data', () => {
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, due_at TEXT,
        completed_at TEXT, version INTEGER NOT NULL, deleted_at TEXT
      );
      CREATE TABLE task_history (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
        before_json TEXT, after_json TEXT NOT NULL, after_version INTEGER NOT NULL,
        operation TEXT NOT NULL, changed_at TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO tasks (id, title, status, priority, created_at, updated_at, version)
      VALUES ('legacy-1', 'Existing task', 'open', 'normal', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z', 1);
      PRAGMA user_version = 1;
    `);

    runMigrations(database);
    expect(database.pragma('user_version', { simple: true })).toBe(4);
    expect(database.prepare('SELECT title, estimate_minutes FROM tasks WHERE id = ?').get('legacy-1'))
      .toEqual({ title: 'Existing task', estimate_minutes: null });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_blocks'").get())
      .toEqual({ name: 'schedule_blocks' });
    database.close();
  });

  it('preserves v1 undo history semantics after migrating task estimate fields', () => {
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, due_at TEXT,
        completed_at TEXT, version INTEGER NOT NULL, deleted_at TEXT
      );
      CREATE TABLE task_history (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
        before_json TEXT, after_json TEXT NOT NULL, after_version INTEGER NOT NULL,
        operation TEXT NOT NULL, changed_at TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0
      );
      PRAGMA user_version = 1;
    `);
    const before = {
      id: 'legacy-task', title: 'Old title', description: null, status: 'open', priority: 'normal',
      projectId: null, createdAt: '2026-09-29T09:00:00.000Z', updatedAt: '2026-09-29T09:00:00.000Z',
      dueAt: null, completedAt: null, version: 1, deletedAt: null,
    };
    const after = { ...before, title: 'New title', version: 2, updatedAt: '2026-09-29T10:00:00.000Z' };
    database.prepare(`INSERT INTO tasks (id, title, status, priority, created_at, updated_at, version)
      VALUES (?, ?, 'open', 'normal', ?, ?, 2)`)
      .run(after.id, after.title, after.createdAt, after.updatedAt);
    database.prepare(`INSERT INTO task_history (task_id, before_json, after_json, after_version, operation, changed_at)
      VALUES (?, ?, ?, 2, 'update', ?)`)
      .run(after.id, JSON.stringify(before), JSON.stringify(after), after.updatedAt);

    runMigrations(database);
    const restored = new SqliteTaskRepository(database).undoLatest('legacy-task');
    expect(restored.title).toBe('Old title');
    expect(restored.estimateMinutes).toBeNull();
    database.close();
  });
});
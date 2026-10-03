import type Database from 'better-sqlite3';
import { DatabaseError } from '../core/errors.js';

const latestSchemaVersion = 4;

export function runMigrations(database: Database.Database): void {
  const currentVersion = database.pragma('user_version', { simple: true }) as number;
  if (currentVersion > latestSchemaVersion) {
    throw new DatabaseError('The TaskFlow database was created by a newer application version.');
  }
  if (currentVersion === latestSchemaVersion) return;

  try {
    const migrate = database.transaction(() => {
      let version = currentVersion;
      if (version < 1) {
        database.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
          priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          due_at TEXT,
          completed_at TEXT,
          version INTEGER NOT NULL CHECK (version > 0),
          deleted_at TEXT
        );
        CREATE INDEX IF NOT EXISTS tasks_status_due ON tasks(status, due_at) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id) WHERE deleted_at IS NULL;
        CREATE TABLE IF NOT EXISTS task_history (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          before_json TEXT,
          after_json TEXT NOT NULL,
          after_version INTEGER NOT NULL,
          operation TEXT NOT NULL,
          changed_at TEXT NOT NULL,
          undone INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS task_history_latest ON task_history(task_id, sequence DESC);
      `);
        database.pragma('user_version = 1');
        version = 1;
      }
      if (version < 2) {
        database.exec(`
          ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER
            CHECK (estimate_minutes IS NULL OR estimate_minutes BETWEEN 5 AND 600);
          CREATE TABLE schedule_blocks (
            id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL,
            task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('work', 'break')),
            starts_at TEXT NOT NULL,
            ends_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            CHECK (ends_at > starts_at)
          );
          CREATE INDEX schedule_blocks_plan ON schedule_blocks(plan_id, starts_at);
          CREATE INDEX schedule_blocks_time ON schedule_blocks(starts_at, ends_at);
        `);
        database.pragma('user_version = 2');
        version = 2;
      }
      if (version < 3) {
        database.exec(`
          CREATE TRIGGER schedule_blocks_no_overlap
          BEFORE INSERT ON schedule_blocks
          WHEN EXISTS (
            SELECT 1 FROM schedule_blocks
            WHERE starts_at < NEW.ends_at AND ends_at > NEW.starts_at
          )
          BEGIN
            SELECT RAISE(ABORT, 'schedule block overlaps an existing block');
          END;
        `);
        database.pragma('user_version = 3');
        version = 3;
      }
      if (version < 4) {
        // A task may declare that it must follow another task. Self-reference is
        // impossible because the column is added before any value can be stored.
        database.exec(`
          ALTER TABLE tasks ADD COLUMN depends_on_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
          CREATE INDEX IF NOT EXISTS tasks_depends_on ON tasks(depends_on_task_id) WHERE deleted_at IS NULL;
        `);
        database.pragma('user_version = 4');
      }
    });
    migrate.immediate();
  } catch (cause) {
    if (cause instanceof DatabaseError) throw cause;
    throw new DatabaseError('Could not initialize the TaskFlow database schema.', { cause });
  }
}
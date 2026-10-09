import Database from 'better-sqlite3';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseError } from '../core/errors.js';
import { runMigrations } from './migrations.js';

export type ConnectionState = 'closed' | 'open';

export class SqliteConnection {
  private database: Database.Database | undefined;
  private currentState: ConnectionState = 'closed';

  constructor(private readonly path: string) {}

  get state(): ConnectionState {
    return this.currentState;
  }

  open(): Database.Database {
    if (this.database) return this.database;
    try {
      if (this.path !== ':memory:') {
        const directory = dirname(this.path);
        const directoryExisted = existsSync(directory);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        if (!directoryExisted) chmodSync(directory, 0o700);
        const descriptor = openSync(this.path, 'a', 0o600);
        closeSync(descriptor);
        chmodSync(this.path, 0o600);
      }
      this.database = new Database(this.path, { timeout: 5000 });
      this.database.pragma('foreign_keys = ON');
      this.database.pragma('busy_timeout = 5000');
      runMigrations(this.database);
      if (this.path !== ':memory:') {
        this.database.pragma('journal_mode = WAL');
      }
      this.currentState = 'open';
      return this.database;
    } catch (cause) {
      let rootCause: unknown = cause;
      try {
        this.database?.close();
      } catch (closeError) {
        rootCause = new AggregateError([cause, closeError], 'Database initialization and cleanup both failed.', { cause });
      }
      this.database = undefined;
      this.currentState = 'closed';
      throw new DatabaseError('Could not open the local TaskFlow database.', { cause: rootCause });
    }
  }

  close(): void {
    if (!this.database) return;
    try {
      this.database.close();
      this.database = undefined;
      this.currentState = 'closed';
    } catch (cause) {
      throw new DatabaseError('Could not close the local TaskFlow database cleanly.', { cause });
    }
  }
}
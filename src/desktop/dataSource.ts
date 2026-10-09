import { DatabaseSync } from 'node:sqlite';

export interface OrbSnapshot {
  dueToday: number;
  overdue: number;
  openTotal: number;
  nextTitle: string | null;
  nextReason: string | null;
  updatedAt: string;
}

/**
 * Read-only data source for the floating orb.
 *
 * The orb deliberately avoids the `better-sqlite3` native addon: that binary is
 * compiled for Node's ABI and cannot load inside Electron, which ships a
 * different one. Node's built-in `node:sqlite` works in both, so the orb reads
 * the same file with no native build and no second copy of the database layer.
 *
 * It opens the database read-only, so it can never modify task data. Every write
 * still goes through the terminal's confirmation flow.
 */
export class OrbDataSource {
  private database: DatabaseSync | undefined;

  constructor(private readonly databasePath: string) {}

  /**
   * Reads the counts the orb displays.
   *
   * A missing or unreadable database yields an empty snapshot rather than an
   * error, so the orb still appears before any task has been added.
   */
  read(): OrbSnapshot {
    const now = new Date();
    const startOfToday = startOfLocalDay(now);
    const endOfToday = new Date(startOfToday.getTime() + DAY_MS);
    const empty: OrbSnapshot = {
      dueToday: 0,
      overdue: 0,
      openTotal: 0,
      nextTitle: null,
      nextReason: null,
      updatedAt: now.toISOString(),
    };

    try {
      const database = this.connect();
      // Read-only mode is a hard guarantee: the orb cannot write even by mistake.
      const today = database.prepare(
        `SELECT COUNT(*) AS total FROM tasks
         WHERE deleted_at IS NULL AND status = 'open' AND due_at IS NOT NULL
           AND due_at >= ? AND due_at <= ?`,
      ).get(startOfToday.toISOString(), endOfToday.toISOString()) as { total: number } | undefined;

      const overdue = database.prepare(
        `SELECT COUNT(*) AS total FROM tasks
         WHERE deleted_at IS NULL AND status = 'open' AND due_at IS NOT NULL AND due_at < ?`,
      ).get(now.toISOString()) as { total: number } | undefined;

      const open = database.prepare(
        `SELECT COUNT(*) AS total FROM tasks WHERE deleted_at IS NULL AND status = 'open'`,
      ).get() as { total: number } | undefined;

      // Ordering mirrors TaskService.rank: overdue first, then nearest deadline,
      // then priority. Only the column names are needed for the suggestion text.
      const next = database.prepare(
        `SELECT title, due_at AS dueAt, priority FROM tasks
         WHERE deleted_at IS NULL AND status = 'open'
         ORDER BY
           CASE WHEN due_at IS NOT NULL AND due_at < ? THEN 0 ELSE 1 END,
           CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
           due_at ASC,
           CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END
         LIMIT 1`,
      ).get(now.toISOString()) as { title: string; dueAt: string | null; priority: string } | undefined;

      return {
        dueToday: Number(today?.total ?? 0),
        overdue: Number(overdue?.total ?? 0),
        openTotal: Number(open?.total ?? 0),
        nextTitle: next?.title ?? null,
        nextReason: next ? explain(next.priority, next.dueAt, now) : null,
        updatedAt: now.toISOString(),
      };
    } catch {
      // The orb must always render, even with no database yet.
      return empty;
    }
  }

  private connect(): DatabaseSync {
    if (this.database) return this.database;
    this.database = new DatabaseSync(this.databasePath, { readOnly: true });
    return this.database;
  }

  /** Closes the handle so shutdown releases the file promptly. */
  close(): void {
    try {
      this.database?.close();
    } catch {
      // Closing an already-closed handle is not an error worth surfacing.
    }
    this.database = undefined;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Mirrors the wording TaskService uses, so both interfaces agree. */
function explain(priority: string, dueAt: string | null, now: Date): string {
  if (dueAt && Date.parse(dueAt) < now.getTime()) return 'It is overdue.';
  if (priority === 'urgent' || priority === 'high') return `It has ${priority} priority.`;
  if (dueAt) return 'It has the nearest deadline among your open tasks.';
  return 'It is the highest-priority open task without an earlier deadline.';
}
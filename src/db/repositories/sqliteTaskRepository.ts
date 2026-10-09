import type Database from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseError } from '../../core/errors.js';
import { TaskConflictError } from '../../core/tasks/taskErrors.js';
import { taskBusinessState, type Task, type TaskQuery } from '../../core/tasks/task.js';
import type { TaskRepository } from '../../core/tasks/taskRepository.js';

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: Task['status'];
  priority: Task['priority'];
  project_id: string | null;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  completed_at: string | null;
  estimate_minutes: number | null;
  depends_on_task_id: string | null;
  version: number;
  deleted_at: string | null;
};

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly db: Database.Database) {}

  create(task: Task): Task {
    try {
      const transaction = this.db.transaction(() => {
        this.writeTask(task);
        this.addHistory(task.id, null, task, 'create');
      });
      transaction();
      return task;
    } catch (cause) {
      throw new DatabaseError('Could not save the new task.', { cause });
    }
  }

  getById(id: string, includeDeleted = false): Task | null {
    const row = this.db.prepare(
      `SELECT * FROM tasks WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
    ).get(id) as TaskRow | undefined;
    return row ? fromRow(row) : null;
  }

  update(task: Task, expectedVersion: number, operation: string): Task {
    try {
      const transaction = this.db.transaction(() => {
        const previous = this.getById(task.id, true);
        if (!previous || previous.version !== expectedVersion) throw new TaskConflictError();
        const next = { ...task, version: expectedVersion + 1 };
        const result = this.writeTask(next, expectedVersion);
        if (result.changes !== 1) throw new TaskConflictError();
        this.addHistory(next.id, previous, next, operation);
        return next;
      });
      return transaction();
    } catch (cause) {
      if (cause instanceof TaskConflictError) throw cause;
      throw new DatabaseError('Could not update the task.', { cause });
    }
  }

  list(query: TaskQuery = {}): Task[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (!query.includeDeleted) clauses.push('deleted_at IS NULL');
    if (query.status) {
      clauses.push('status = ?');
      values.push(query.status);
    }
    if (query.priority) {
      clauses.push('priority = ?');
      values.push(query.priority);
    }
    if (query.projectId) {
      clauses.push('project_id = ?');
      values.push(query.projectId);
    }
    if (query.text) {
      clauses.push("(instr(lower(title), lower(?)) > 0 OR instr(lower(coalesce(description, '')), lower(?)) > 0)");
      values.push(query.text, query.text);
    }
    if (query.dueAfter) {
      clauses.push('due_at >= ?');
      values.push(query.dueAfter);
    }
    if (query.dueBefore) {
      clauses.push('due_at <= ?');
      values.push(query.dueBefore);
    }
    if (query.overdueAt) {
      clauses.push('status = \'open\' AND due_at < ?');
      values.push(query.overdueAt);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(query.limit ?? 100, 500));
    const offset = Math.max(0, query.offset ?? 0);
    const rows = this.db.prepare(
      `SELECT * FROM tasks ${where} ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, created_at LIMIT ? OFFSET ?`,
    ).all(...values, limit, offset) as TaskRow[];
    return rows.map(fromRow);
  }

  undoLatest(id: string): Task {
    try {
      const transaction = this.db.transaction(() => {
        const current = this.getById(id, true);
        const entry = this.db.prepare(
          'SELECT sequence, before_json, after_json FROM task_history WHERE task_id = ? AND undone = 0 ORDER BY sequence DESC LIMIT 1',
        ).get(id) as { sequence: number; before_json: string | null; after_json: string } | undefined;
        if (!current || !entry) throw new TaskConflictError('There is no task change available to undo.');

        const expectedAfter = fromSnapshot(entry.after_json);
        if (!isDeepStrictEqual(taskBusinessState(current), taskBusinessState(expectedAfter))) {
          throw new TaskConflictError('A newer task change conflicts with this undo. Nothing was changed.');
        }

        const previous = entry.before_json ? fromSnapshot(entry.before_json) : null;
        const now = new Date().toISOString();
        const restored: Task = previous
          ? { ...previous, version: current.version + 1, updatedAt: now }
          : { ...current, deletedAt: now, version: current.version + 1, updatedAt: now };
        const result = this.writeTask(restored, current.version);
        if (result.changes !== 1) throw new TaskConflictError();
        this.db.prepare('UPDATE task_history SET undone = 1 WHERE sequence = ?').run(entry.sequence);
        return restored;
      });
      return transaction.immediate();
    } catch (cause) {
      if (cause instanceof TaskConflictError) throw cause;
      throw new DatabaseError('Could not undo the task change.', { cause });
    }
  }

  private writeTask(task: Task, expectedVersion?: number): Database.RunResult {
    const fields = [
      task.id, task.title, task.description, task.status, task.priority, task.projectId,
      task.createdAt, task.updatedAt, task.dueAt, task.completedAt,
      task.estimateMinutes, task.dependsOnTaskId, task.version, task.deletedAt,
    ];
    if (expectedVersion === undefined) {
      return this.db.prepare(`
        INSERT INTO tasks (id, title, description, status, priority, project_id, created_at, updated_at, due_at, completed_at, estimate_minutes, depends_on_task_id, version, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...fields);
    }
    return this.db.prepare(`
      UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, project_id = ?, created_at = ?, updated_at = ?, due_at = ?, completed_at = ?, estimate_minutes = ?, depends_on_task_id = ?, version = ?, deleted_at = ?
      WHERE id = ? AND version = ?
    `).run(
      task.title, task.description, task.status, task.priority, task.projectId,
      task.createdAt, task.updatedAt, task.dueAt, task.completedAt,
      task.estimateMinutes, task.dependsOnTaskId, task.version, task.deletedAt, task.id, expectedVersion,
    );
  }

  private addHistory(id: string, before: Task | null, after: Task, operation: string): void {
    this.db.prepare(`
      INSERT INTO task_history (task_id, before_json, after_json, after_version, operation, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, before ? JSON.stringify(before) : null, JSON.stringify(after), after.version, operation, after.updatedAt);
  }
}

function fromRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    estimateMinutes: row.estimate_minutes,
    dependsOnTaskId: row.depends_on_task_id ?? null,
    version: row.version,
    deletedAt: row.deleted_at,
  };
}

function fromSnapshot(json: string): Task {
  const snapshot = JSON.parse(json) as Task;
  // History written before dependencies existed has no such field.
  return {
    ...snapshot,
    estimateMinutes: snapshot.estimateMinutes ?? null,
    dependsOnTaskId: snapshot.dependsOnTaskId ?? null,
  };
}
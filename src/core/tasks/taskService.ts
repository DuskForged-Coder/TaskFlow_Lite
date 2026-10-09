import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { UserError } from '../errors.js';
import type { ProjectRepository } from '../projects/projectRepository.js';
import { TaskConflictError, TaskNotFoundError } from './taskErrors.js';
import type { CreateTaskInput, Task, TaskPriority, TaskQuery, UpdateTaskInput } from './task.js';
import type { TaskRepository } from './taskRepository.js';

export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    private readonly projects?: ProjectRepository,
  ) {}

  createTask(input: CreateTaskInput): Task {
    const now = this.clock().toISOString();
    const projectId = input.projectId ?? null;
    if (projectId !== null && !this.projects?.getById(projectId)) throw new UserError('That project does not exist.');
    const task: Task = {
      id: this.createId(),
      title: validateTitle(input.title),
      description: normalizeDescription(input.description),
      status: 'open',
      priority: validatePriority(input.priority ?? 'normal'),
      projectId,
      createdAt: now,
      updatedAt: now,
      dueAt: normalizeDate(input.dueAt),
      completedAt: null,
      estimateMinutes: normalizeEstimate(input.estimateMinutes),
      dependsOnTaskId: null,
      version: 1,
      deletedAt: null,
    };
    return this.repository.create(task);
  }

  updateTask(id: string, input: UpdateTaskInput, expectedVersion?: number): Task {
    const current = this.requireTask(id);
    if (input.projectId && !this.projects?.getById(input.projectId)) throw new UserError('That project does not exist.');
    const version = this.resolveVersion(current, expectedVersion);
    const next: Task = {
      ...current,
      ...(input.title === undefined ? {} : { title: validateTitle(input.title) }),
      ...(input.description === undefined ? {} : { description: normalizeDescription(input.description) }),
      ...(input.priority === undefined ? {} : { priority: validatePriority(input.priority) }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.dueAt === undefined ? {} : { dueAt: normalizeDate(input.dueAt) }),
      ...(input.estimateMinutes === undefined ? {} : { estimateMinutes: normalizeEstimate(input.estimateMinutes) }),
      ...(input.dependsOnTaskId === undefined ? {} : { dependsOnTaskId: this.validateDependency(current.id, input.dependsOnTaskId) }),
      updatedAt: this.clock().toISOString(),
    };
    return this.repository.update(next, version, 'update');
  }

  completeTask(id: string, expectedVersion?: number): Task {
    const current = this.requireTask(id);
    if (current.status === 'completed') return current;
    return this.repository.update({ ...current, status: 'completed', completedAt: this.clock().toISOString(), updatedAt: this.clock().toISOString() }, this.resolveVersion(current, expectedVersion), 'complete');
  }

  reopenTask(id: string, expectedVersion?: number): Task {
    const current = this.requireTask(id);
    if (current.status === 'open') return current;
    return this.repository.update({ ...current, status: 'open', completedAt: null, updatedAt: this.clock().toISOString() }, this.resolveVersion(current, expectedVersion), 'reopen');
  }

  deleteTask(id: string, expectedVersion?: number): Task {
    const current = this.requireTask(id);
    return this.repository.update({ ...current, deletedAt: this.clock().toISOString(), updatedAt: this.clock().toISOString() }, this.resolveVersion(current, expectedVersion), 'delete');
  }

  restoreTask(id: string, expectedVersion?: number): Task {
    const current = this.repository.getById(id, true);
    if (!current) throw new TaskNotFoundError(id);
    if (!current.deletedAt) throw new UserError('This task is not deleted.');
    return this.repository.update({ ...current, deletedAt: null, updatedAt: this.clock().toISOString() }, this.resolveVersion(current, expectedVersion), 'restore');
  }

  setPriority(id: string, priority: TaskPriority, expectedVersion?: number): Task {
    return this.updateTask(id, { priority }, expectedVersion);
  }

  setDeadline(id: string, dueAt: string | null, expectedVersion?: number): Task {
    return this.updateTask(id, { dueAt }, expectedVersion);
  }

  setEstimate(id: string, estimateMinutes: number | null, expectedVersion?: number): Task {
    return this.updateTask(id, { estimateMinutes }, expectedVersion);
  }

  moveTask(id: string, dueAt: string, expectedVersion?: number): Task {
    return this.setDeadline(id, dueAt, expectedVersion);
  }

  assignProject(id: string, projectId: string | null, expectedVersion?: number): Task {
    if (projectId !== null && !this.projects?.getById(projectId)) throw new UserError('That project does not exist.');
    return this.updateTask(id, { projectId }, expectedVersion);
  }

  listTasks(query: TaskQuery = {}): Task[] {
    return this.repository.list(query);
  }

  /** Returns a task by id, or null when it is missing or soft-deleted. */
  getTask(id: string): Task | null {
    return this.repository.getById(id);
  }

  searchTasks(text: string, query: Omit<TaskQuery, 'text'> = {}): Task[] {
    const search = text.trim();
    if (!search) throw new UserError('Enter a word or phrase to search for.');
    return this.repository.list({ ...query, text: search });
  }

  overdueTasks(now = this.clock()): Task[] {
    return this.repository.list({ overdueAt: now.toISOString() });
  }

  recommendNextTask(now = this.clock()): { task: Task; reason: string } | null {
    const candidates = this.repository.list({ status: 'open' });
    candidates.sort((left, right) => rank(right, now) - rank(left, now));
    const task = candidates[0];
    if (!task) return null;
    const reason = task.dueAt && Date.parse(task.dueAt) < now.getTime()
      ? 'It is overdue.'
      : task.priority === 'urgent' || task.priority === 'high'
        ? `It has ${task.priority} priority.`
        : task.dueAt
          ? 'It has the nearest deadline among your open tasks.'
          : 'It is the highest-priority open task without an earlier deadline.';
    return { task, reason };
  }

  undoLastChange(id: string): Task {
    if (!this.repository.getById(id, true)) throw new TaskNotFoundError(id);
    return this.repository.undoLatest(id);
  }

  /**
   * Records that `taskId` must follow `dependsOnTaskId`. Cycles are rejected so
   * the planner can never be asked to order an impossible sequence.
   */
  setDependency(taskId: string, dependsOnTaskId: string | null, expectedVersion?: number): Task {
    const current = this.requireTask(taskId);
    const resolved = this.validateDependency(current.id, dependsOnTaskId);
    return this.repository.update({ ...current, dependsOnTaskId: resolved, updatedAt: this.clock().toISOString() }, this.resolveVersion(current, expectedVersion), 'update');
  }

  /**
   * Validates a dependency edge: the target must exist and must not create a
   * cycle, so the planner can always topologically order the workload.
   */
  private validateDependency(taskId: string, dependsOnTaskId: string | null): string | null {
    if (dependsOnTaskId === null) return null;
    if (dependsOnTaskId === taskId) throw new UserError('A task cannot depend on itself.');
    if (!this.repository.getById(dependsOnTaskId)) throw new UserError('That dependency does not exist.');
    if (this.wouldCycle(taskId, dependsOnTaskId)) {
      throw new UserError('That dependency would create a circular chain between tasks.');
    }
    return dependsOnTaskId;
  }

  private wouldCycle(taskId: string, dependsOnTaskId: string): boolean {
    const seen = new Set<string>([taskId]);
    let current: string | null = dependsOnTaskId;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = this.repository.getById(current)?.dependsOnTaskId ?? null;
    }
    return false;
  }

  private requireTask(id: string): Task {
    const task = this.repository.getById(id);
    if (!task) throw new TaskNotFoundError(id);
    return task;
  }

  private resolveVersion(current: Task, expectedVersion?: number): number {
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new TaskConflictError();
    return expectedVersion ?? current.version;
  }
}

function validateTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) throw new UserError('A task title cannot be empty.');
  if (normalized.length > 200) throw new UserError('A task title cannot exceed 200 characters.');
  if (/[\u0000-\u001F\u007F-\u009F]/.test(normalized)) throw new UserError('A task title cannot contain terminal control characters.');
  return normalized;
}

function normalizeDescription(description: string | null | undefined): string | null {
  if (description == null) return null;
  const normalized = description.trim();
  if (normalized.length > 4000) throw new UserError('A task description cannot exceed 4000 characters.');
  if (/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/.test(normalized)) throw new UserError('A task description cannot contain terminal control characters.');
  return normalized || null;
}

function normalizeDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const date = DateTime.fromISO(value, { setZone: true });
  if (!date.isValid) throw new UserError('Enter a valid ISO date and time.');
  const normalized = date.toUTC().toISO({ suppressMilliseconds: false });
  if (!normalized) throw new UserError('Enter a valid ISO date and time.');
  return normalized;
}

function normalizeEstimate(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 5 || value > 600) {
    throw new UserError('Task estimates must be whole minutes from 5 to 600.');
  }
  return value;
}

function validatePriority(priority: TaskPriority): TaskPriority {
  if (!['low', 'normal', 'high', 'urgent'].includes(priority)) throw new UserError('Choose low, normal, high, or urgent priority.');
  return priority;
}

function rank(task: Task, now: Date): number {
  const priorityScore: Record<TaskPriority, number> = { low: 1, normal: 2, high: 3, urgent: 4 };
  const deadlineScore = task.dueAt
    ? Math.max(-100, Math.min(100, 48 - (Date.parse(task.dueAt) - now.getTime()) / 3_600_000))
    : 0;
  const overdueBonus = task.dueAt && Date.parse(task.dueAt) < now.getTime() ? 1000 : 0;
  return overdueBonus + deadlineScore + priorityScore[task.priority] * 10;
}
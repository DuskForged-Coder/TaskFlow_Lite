import type { Task, TaskQuery } from './task.js';

export interface TaskRepository {
  create(task: Task): Task;
  getById(id: string, includeDeleted?: boolean): Task | null;
  update(task: Task, expectedVersion: number, operation: string): Task;
  list(query?: TaskQuery): Task[];
  undoLatest(id: string): Task;
}
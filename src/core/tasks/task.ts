export type TaskStatus = 'open' | 'completed';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  completedAt: string | null;
  estimateMinutes: number | null;
  /** Task that must be completed before this one can be meaningfully scheduled. */
  dependsOnTaskId: string | null;
  version: number;
  deletedAt: string | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  projectId?: string | null;
  dueAt?: string | null;
  estimateMinutes?: number | null;
  dependsOnTaskId?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  projectId?: string | null;
  dueAt?: string | null;
  estimateMinutes?: number | null;
  dependsOnTaskId?: string | null;
}

export interface TaskQuery {
  status?: TaskStatus;
  priority?: TaskPriority;
  projectId?: string;
  text?: string;
  dueAfter?: string;
  dueBefore?: string;
  overdueAt?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export function taskBusinessState(task: Task): Omit<Task, 'version' | 'updatedAt'> {
  const state = { ...task };
  Reflect.deleteProperty(state, 'version');
  Reflect.deleteProperty(state, 'updatedAt');
  return state;
}
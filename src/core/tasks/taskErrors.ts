import { TaskFlowError } from '../errors.js';

export class TaskNotFoundError extends TaskFlowError {
  constructor(id: string) {
    super(`Task ${id} was not found.`, 'user');
    this.name = 'TaskNotFoundError';
  }
}

export class TaskConflictError extends TaskFlowError {
  constructor(message = 'This task changed since it was loaded. Review it and try again.') {
    super(message, 'user');
    this.name = 'TaskConflictError';
  }
}
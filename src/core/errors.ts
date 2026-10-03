export type ErrorCategory =
  | 'user'
  | 'configuration'
  | 'ai'
  | 'database'
  | 'network'
  | 'application';

export class TaskFlowError extends Error {
  constructor(
    message: string,
    readonly category: ErrorCategory,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TaskFlowError';
  }
}

export class UserError extends TaskFlowError {
  constructor(message: string) {
    super(message, 'user');
    this.name = 'UserError';
  }
}

export class ConfigurationError extends TaskFlowError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'configuration', options);
    this.name = 'ConfigurationError';
  }
}

export class DatabaseError extends TaskFlowError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'database', options);
    this.name = 'DatabaseError';
  }
}

export class AIError extends TaskFlowError {
  constructor(message = 'TaskFlow could not safely interpret that request.', options?: ErrorOptions) {
    super(message, 'ai', options);
    this.name = 'AIError';
  }
}

export class NetworkError extends TaskFlowError {
  constructor(message = 'The AI service is temporarily unavailable.', options?: ErrorOptions) {
    super(message, 'network', options);
    this.name = 'NetworkError';
  }
}

export function toUserMessage(error: unknown): string {
  if (error instanceof TaskFlowError) return error.message;
  return 'TaskFlow encountered an unexpected error. See the local log for details.';
}
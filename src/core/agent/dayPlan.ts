export type ScheduleBlockKind = 'work' | 'break';

/**
 * A duration TaskFlow supplied rather than one the user recorded. Assumptions are
 * surfaced to the user so they can correct them, never applied silently.
 */
export interface PlanAssumption {
  taskId: string;
  title: string;
  assumedMinutes: number;
  basis: string;
}

export type PlanConflictKind =
  | 'no_estimate'
  | 'insufficient_time'
  | 'over_capacity'
  | 'blocked_by_dependency'
  | 'already_scheduled';

/** A reason the plan could not honour the full workload. */
export interface PlanConflict {
  kind: PlanConflictKind;
  title: string;
  detail: string;
}

/** A mutation the plan would perform if the user approves it. */
export type ProposedChange =
  | { kind: 'create_schedule_block'; blockId: string; label: string; startsAt: string; endsAt: string }
  | { kind: 'set_estimate'; taskId: string; title: string; estimateMinutes: number };

/**
 * Adjustments the user asked for while iterating on a plan. These only ever feed
 * a fresh proposal; they never mutate stored data on their own.
 */
export interface PlanConstraints {
  /** Do not schedule anything before this instant. */
  notBefore?: string;
  /** Extra minutes granted to a specific task, by task id. */
  extraMinutesByTaskId?: Record<string, number>;
  /** Committed time the user described, such as a class they forgot to record. */
  busyIntervals?: Array<{ label: string; startsAt: string; endsAt: string }>;
}

export interface ProposedScheduleBlock {
  id: string;
  taskId: string | null;
  taskVersion: number | null;
  label: string;
  kind: ScheduleBlockKind;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export interface DayPlan {
  id: string;
  createdAt: string;
  startsAt: string;
  endsAt: string;
  availableMinutes: number;
  workMinutes: number;
  breakMinutes: number;
  committedMinutes: number;
  bufferMinutes: number;
  blocks: ProposedScheduleBlock[];
  omittedTasks: Array<{ title: string; reason: string }>;
  contextNotes: string[];
  /** Durations TaskFlow supplied because the task had none recorded. */
  assumptions: PlanAssumption[];
  /** Work the plan could not fit, and why. Never silently dropped. */
  conflicts: PlanConflict[];
  /** Exactly what applying this plan would write. */
  proposedChanges: ProposedChange[];
  /** Total estimated minutes of the considered workload, before fitting. */
  requiredMinutes: number;
}

export interface ScheduleBlock extends Omit<ProposedScheduleBlock, 'taskVersion' | 'reason'> {
  planId: string;
  createdAt: string;
}
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { UserError } from '../errors.js';
import type { Task } from '../tasks/task.js';
import type { TaskService } from '../tasks/taskService.js';
import { formatTaskDate } from '../../utils/dates.js';
import type { DayPlan, PlanAssumption, PlanConstraints, PlanConflict, ProposedChange, ProposedScheduleBlock, ScheduleBlock } from './dayPlan.js';
import type { ScheduleBlockRepository } from './scheduleBlockRepository.js';

export class DayPlanService {
  constructor(
    private readonly tasks: TaskService,
    private readonly schedules: ScheduleBlockRepository,
    private readonly timezone: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    private readonly projectName: (projectId: string | null) => string | null = () => null,
  ) {}

  propose(availableMinutes: number, constraints: PlanConstraints = {}): DayPlan {
    if (!Number.isSafeInteger(availableMinutes) || availableMinutes < 15 || availableMinutes > 960) {
      throw new UserError('Plan windows must be from 15 minutes to 16 hours.');
    }
    const now = this.clock();
    const end = new Date(now.getTime() + availableMinutes * 60_000);
    const existingBlocks = this.schedules.listOverlapping(now.toISOString(), end.toISOString());
    // Commitments the user described in this conversation are treated exactly
    // like saved blocks: kept clear, and counted against the window.
    const spoken = (constraints.busyIntervals ?? []).map((interval) => ({
      id: `spoken-${interval.startsAt}`,
      planId: '',
      taskId: null,
      label: interval.label,
      kind: 'break' as const,
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
      createdAt: now.toISOString(),
    }));
    const busy = [...existingBlocks, ...spoken];
    const alreadyScheduled = new Set<string>(existingBlocks.filter((block) => block.kind === 'work' && block.taskId).map((block) => block.taskId as string));
    const openTasks = this.tasks.listTasks({ status: 'open' });

    const assumptions: PlanAssumption[] = [];
    const conflicts: PlanConflict[] = [];
    // A task with no recorded duration is still real work, so the planner assumes
    // one rather than dropping it. The assumption is reported so the user can fix it.
    const estimated = openTasks
      .filter((task) => !alreadyScheduled.has(task.id))
      .map((task) => {
        const extra = constraints.extraMinutesByTaskId?.[task.id] ?? 0;
        if (task.estimateMinutes !== null) {
          return { task, minutes: task.estimateMinutes + extra, assumed: false };
        }
        const assumedMinutes = DEFAULT_ASSUMED_MINUTES + extra;
        assumptions.push({
          taskId: task.id,
          title: task.title,
          assumedMinutes,
          basis: `No duration is recorded, so this proposal assumes ${formatMinutes(assumedMinutes)}. Use “estimate ${task.title} for 45 minutes” to correct it.`,
        });
        return { task, minutes: assumedMinutes, assumed: true };
      });
    const requiredMinutes = estimated.reduce((total, entry) => total + entry.minutes, 0);

    for (const task of openTasks) {
      if (alreadyScheduled.has(task.id)) {
        conflicts.push({
          kind: 'already_scheduled',
          title: task.title,
          detail: 'It already has an approved schedule block in this window.',
        });
      }
    }

    const ordered = orderByDependencies(estimated);
    const blocks: ProposedScheduleBlock[] = [];
    const omittedTasks: Array<{ title: string; reason: string }> = [];
    // A user-supplied floor ("don't schedule anything before 10") shifts the
    // start of the window without changing its total length.
    const floor = constraints.notBefore ? Math.max(now.getTime(), Date.parse(constraints.notBefore)) : now.getTime();
    let cursor = floor;
    let workMinutes = 0;
    let breakMinutes = 0;
    let focusMinutes = 0;
    const committedMinutes = busy.reduce((total, block) => {
      const overlapStart = Math.max(floor, Date.parse(block.startsAt));
      const overlapEnd = Math.min(end.getTime(), Date.parse(block.endsAt));
      return total + Math.max(0, Math.round((overlapEnd - overlapStart) / 60_000));
    }, 0);

    const placedTaskIds = new Set<string>();
    for (const { task, minutes: estimate } of ordered) {
      // orderByDependencies put prerequisites first, so a prerequisite that is
      // still open here was not scheduled: either it did not fit, or it was
      // blocked itself. Either way this task cannot be scheduled yet.
      const unmetId = unmetDependency(task, placedTaskIds, alreadyScheduled);
      if (unmetId) {
        const unmetTitle = openTasks.find((candidate) => candidate.id === unmetId)?.title ?? unmetId;
        conflicts.push({ kind: 'blocked_by_dependency', title: task.title, detail: `It must follow “${unmetTitle}”, which is not scheduled in this window.` });
        omittedTasks.push({ title: task.title, reason: `Waiting on “${unmetTitle}”.` });
        continue;
      }
      let remainingTaskMinutes = estimate;
      let plannedCursor = cursor;
      let plannedFocusMinutes = focusMinutes;
      let plannedBreakMinutes = 0;
      const taskBlocks: ProposedScheduleBlock[] = [];
      while (remainingTaskMinutes > 0) {
        if (plannedFocusMinutes >= 50) {
          plannedCursor = movePastBusyBlocks(plannedCursor, 10, busy);
          const breakBlock = this.createBlock(null, null, 'Break', 'break', plannedCursor, 10, 'A 10-minute break after a focused work block.');
          taskBlocks.push(breakBlock);
          plannedCursor = Date.parse(breakBlock.endsAt);
          plannedBreakMinutes += 10;
          plannedFocusMinutes = 0;
        }
        const segmentMinutes = Math.min(remainingTaskMinutes, 50 - plannedFocusMinutes);
        plannedCursor = movePastBusyBlocks(plannedCursor, segmentMinutes, busy);
        const workBlock = this.createBlock(
          task.id,
          task.version,
          this.planTaskLabel(task),
          'work',
          plannedCursor,
          segmentMinutes,
          explainOrder(task, now, this.projectName(task.projectId)),
        );
        taskBlocks.push(workBlock);
        plannedCursor = Date.parse(workBlock.endsAt);
        plannedFocusMinutes += segmentMinutes;
        remainingTaskMinutes -= segmentMinutes;
      }
      if (workMinutes + breakMinutes + estimate + plannedBreakMinutes > availableMinutes || plannedCursor > end.getTime()) {
        // This is the "impossible plan" case from the spec: say so plainly instead
        // of pretending the workload fits.
        const detail = `Needs about ${formatMinutes(estimate)} but the remaining window cannot hold it. Consider moving it, shortening the estimate, or replanning with more time.`;
        conflicts.push({ kind: 'insufficient_time', title: task.title, detail });
        omittedTasks.push({ title: task.title, reason: `The ${formatMinutes(estimate)} estimate does not fit in the remaining window.` });
        continue;
      }
      blocks.push(...taskBlocks);
      placedTaskIds.add(task.id);
      cursor = plannedCursor;
      workMinutes += estimate;
      breakMinutes += plannedBreakMinutes;
      focusMinutes = plannedFocusMinutes;
    }

    const unscheduledMinutes = requiredMinutes - workMinutes;
    // A global over-capacity conflict explains the trade-off in one sentence.
    if (unscheduledMinutes > 0 && omittedTasks.length > 0) {
      conflicts.unshift({
        kind: 'over_capacity',
        title: 'Workload exceeds the window',
        detail: `You have about ${formatMinutes(Math.max(0, availableMinutes - committedMinutes))} of free time, but this workload needs roughly ${formatMinutes(requiredMinutes)}. ${omittedTasks.length} task(s) are unscheduled; move or shorten them rather than overloading today.`,
      });
    }

    const proposedChanges: ProposedChange[] = blocks.map((block) => ({
      kind: 'create_schedule_block' as const,
      blockId: block.id,
      label: block.label,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
    }));
    // Recording the durations we assumed is itself a proposed, approved change.
    for (const assumption of assumptions) {
      proposedChanges.push({
        kind: 'set_estimate',
        taskId: assumption.taskId,
        title: assumption.title,
        estimateMinutes: assumption.assumedMinutes,
      });
    }

    return {
      id: this.createId(),
      createdAt: now.toISOString(),
      startsAt: now.toISOString(),
      endsAt: end.toISOString(),
      availableMinutes,
      workMinutes,
      breakMinutes,
      committedMinutes,
      bufferMinutes: availableMinutes - workMinutes - breakMinutes - committedMinutes,
      blocks,
      omittedTasks,
      contextNotes: [
        'No calendar is connected; this plan uses TaskFlow tasks and saved schedule blocks only.',
        ...(existingBlocks.length ? [`${existingBlocks.length} existing TaskFlow schedule block(s) were kept clear.`] : []),
        ...(spoken.length ? [`${spoken.length} commitment(s) you described were kept clear.`] : []),
      ],
      assumptions,
      conflicts,
      proposedChanges,
      requiredMinutes,
    };
  }

  apply(plan: DayPlan): ScheduleBlock[] {
    const currentTasks = new Map(this.tasks.listTasks({ status: 'open' }).map((task) => [task.id, task]));
    const priorBlocks = this.blocksForRange(plan.startsAt, plan.endsAt);
    for (const block of plan.blocks) {
      if (block.taskId) {
        const task = currentTasks.get(block.taskId);
        if (!task || task.version !== block.taskVersion) {
          throw new UserError(`“${block.label}” changed after the plan was proposed. Replan before applying.`);
        }
      }
      if (priorBlocks.some((existing) => overlaps(block.startsAt, block.endsAt, existing.startsAt, existing.endsAt))) {
        throw new UserError('An existing TaskFlow schedule block overlaps this plan. Replan for a different time window.');
      }
    }

    const createdAt = this.clock().toISOString();
    const toStore: ScheduleBlock[] = plan.blocks.map((block) => ({
      id: block.id,
      planId: plan.id,
      taskId: block.taskId,
      label: block.label,
      kind: block.kind,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      createdAt,
    }));
    const saved = this.schedules.createPlan(plan.id, toStore);
    if (saved.length !== toStore.length) throw new UserError('TaskFlow could not verify every approved schedule block.');
    for (const expected of toStore) {
      if (!saved.some((actual) => actual.id === expected.id && actual.startsAt === expected.startsAt && actual.endsAt === expected.endsAt)) {
        throw new UserError('A schedule block did not match the approved plan. No further actions were taken.');
      }
    }
    // Durations the planner assumed become real only now, and only through
    // TaskService so the usual estimate validation still applies.
    for (const assumption of plan.assumptions) {
      const task = this.tasks.getTask(assumption.taskId);
      if (task && task.estimateMinutes === null) {
        this.tasks.updateTask(assumption.taskId, { estimateMinutes: assumption.assumedMinutes });
      }
    }
    return saved;
  }

  savedPlan(planId: string): ScheduleBlock[] {
    return this.schedules.listByPlan(planId);
  }

  scheduleForToday(now = this.clock()): ScheduleBlock[] {
    const localStart = DateTime.fromJSDate(now, { zone: this.timezone }).startOf('day').toUTC().toISO();
    const localEnd = DateTime.fromJSDate(now, { zone: this.timezone }).endOf('day').toUTC().toISO();
    if (!localStart || !localEnd) throw new UserError('TaskFlow could not calculate today’s schedule range.');
    return this.schedules.listOverlapping(localStart, localEnd);
  }

  formatApplied(blocks: readonly ScheduleBlock[]): string {
    return blocks.map((block) => {
      const start = DateTime.fromISO(block.startsAt, { zone: 'utc' }).setZone(this.timezone).toFormat('HH:mm');
      const end = DateTime.fromISO(block.endsAt, { zone: 'utc' }).setZone(this.timezone).toFormat('HH:mm');
      return `${start}–${end} ${block.label}`;
    }).join('\n');
  }

  format(plan: DayPlan): string {
    const lines = [
      `TODAY'S PROPOSED PLAN · ${formatMinutes(plan.availableMinutes)} available`,
      `Work ${formatMinutes(plan.workMinutes)} · Breaks ${formatMinutes(plan.breakMinutes)} · Committed ${formatMinutes(plan.committedMinutes)} · Buffer ${formatMinutes(plan.bufferMinutes)}`,
    ];
    for (const block of plan.blocks) {
      const start = formatTaskDate(block.startsAt, this.timezone);
      const end = DateTime.fromISO(block.endsAt, { zone: 'utc' }).setZone(this.timezone).toFormat('HH:mm');
      lines.push(`${start}–${end}  ${block.kind === 'work' ? block.label : 'Break'}`);
      if (block.kind === 'work') lines.push(`  Why: ${block.reason}`);
    }
    if (plan.blocks.length === 0) {
      lines.push('No tasks could be scheduled. Add estimates with “estimate <task> for 45 minutes”, or free up more time.');
    }
    // Assumptions are shown before conflicts so the user can correct the input
    // that produced them.
    if (plan.assumptions.length) {
      lines.push('', 'Assumptions:');
      for (const assumption of plan.assumptions) lines.push(`  ${assumption.title}: ${assumption.basis}`);
    }
    if (plan.conflicts.length) {
      lines.push('', 'Trade-offs:');
      for (const conflict of plan.conflicts) lines.push(`  ${conflict.title}: ${conflict.detail}`);
    }
    if (plan.omittedTasks.length) {
      lines.push('', `${plan.omittedTasks.length} task(s) remain unscheduled: ${plan.omittedTasks.map(({ title }) => title).join(', ')}`);
    }
    lines.push('', ...plan.contextNotes);
    lines.push('Nothing has been changed. Apply this plan? Type y to apply, e to revise, or n to cancel.');
    return lines.join('\n');
  }

  private createBlock(
    taskId: string | null,
    taskVersion: number | null,
    label: string,
    kind: ProposedScheduleBlock['kind'],
    startsAt: number,
    minutes: number,
    reason: string,
  ): ProposedScheduleBlock {
    return {
      id: this.createId(),
      taskId,
      taskVersion,
      label,
      kind,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + minutes * 60_000).toISOString(),
      reason,
    };
  }

  private planTaskLabel(task: Task): string {
    const project = this.projectName(task.projectId);
    return project ? `${task.title} · ${project}` : task.title;
  }

  private blocksForRange(startsAt: string, endsAt: string): ScheduleBlock[] {
    return this.schedules.listOverlapping(startsAt, endsAt);
  }
}

/** Minutes assumed for a task that has no recorded duration. */
const DEFAULT_ASSUMED_MINUTES = 60;

export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/**
 * Orders candidates by urgency, then pulls any task ahead of the task it depends
 * on so a prerequisite is always scheduled before its dependent.
 */
function orderByDependencies<T extends { task: Task }>(entries: readonly T[]): T[] {
  const byId = new Map(entries.map((entry) => [entry.task.id, entry]));
  const now = new Date();
  const sorted = [...entries].sort((left, right) =>
    rank(right.task, now) - rank(left.task, now) || left.task.createdAt.localeCompare(right.task.createdAt));
  const ordered: T[] = [];
  const placed = new Set<string>();
  // Depth-first placement guarantees dependencies come first; the placed set
  // stops a pre-existing cycle from looping forever.
  const visit = (entry: T): void => {
    if (placed.has(entry.task.id)) return;
    placed.add(entry.task.id);
    const prerequisiteId = entry.task.dependsOnTaskId;
    const prerequisiteEntry = prerequisiteId ? byId.get(prerequisiteId) : undefined;
    if (prerequisiteEntry && !placed.has(prerequisiteEntry.task.id)) visit(prerequisiteEntry);
    ordered.push(entry);
  };
  for (const entry of sorted) visit(entry);
  return ordered;
}

/**
 * Returns the title of a prerequisite that is still unscheduled, or null when the
 * task may be scheduled. A prerequisite is satisfied when this plan has already
 * placed it, it holds an approved block, or it is no longer open.
 */
function unmetDependency(
  task: Task,
  placedTaskIds: ReadonlySet<string>,
  alreadyScheduled: ReadonlySet<string>,
): string | null {
  const prerequisiteId = task.dependsOnTaskId;
  if (!prerequisiteId) return null;
  if (placedTaskIds.has(prerequisiteId) || alreadyScheduled.has(prerequisiteId)) return null;
  return prerequisiteId;
}

function rank(task: Task, now: Date): number {
  const priority = { low: 1, normal: 2, high: 3, urgent: 4 }[task.priority];
  if (task.dueAt === null) return priority * 10;
  const minutesUntilDue = (Date.parse(task.dueAt) - now.getTime()) / 60_000;
  if (minutesUntilDue < 0) return 10_000 + priority * 10;
  return Math.max(0, 5_000 - minutesUntilDue) + priority * 10;
}

function explainOrder(task: Task, now: Date, projectName: string | null): string {
  const context = projectName ? ` Project: ${projectName}.` : '';
  if (task.dueAt && Date.parse(task.dueAt) < now.getTime()) return `Overdue work is protected first.${context}`;
  if (task.dueAt && Date.parse(task.dueAt) - now.getTime() <= 24 * 60 * 60_000) return `Its deadline is within 24 hours.${context}`;
  if (task.priority === 'urgent' || task.priority === 'high') return `It has ${task.priority} priority.${context}`;
  if (task.dueAt) return `It has the earliest remaining deadline.${context}`;
  return `It is a higher-priority estimated task.${context}`;
}

function overlaps(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string): boolean {
  return Date.parse(firstStart) < Date.parse(secondEnd) && Date.parse(firstEnd) > Date.parse(secondStart);
}

function movePastBusyBlocks(start: number, durationMinutes: number, busy: readonly ScheduleBlock[]): number {
  let candidate = start;
  for (const block of busy) {
    if (candidate < Date.parse(block.endsAt) && candidate + durationMinutes * 60_000 > Date.parse(block.startsAt)) {
      candidate = Date.parse(block.endsAt);
    }
  }
  return candidate;
}
import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import type { TaskIntent } from '../ai/schema.js';

export function parseCommand(
  input: string,
  options: { now?: Date; timezone: string },
): TaskIntent | null {
  const command = input.trim().replace(/[?.!]+$/, '').trim();
  if (!command) return null;
  const now = options.now ?? new Date();
  const localNow = DateTime.fromJSDate(now, { zone: options.timezone });

  const planMatch = command.match(/^(?:plan(?:\s+(?:the\s+)?next)?|i have)\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)(?:\b.*)?$/i);
  if (planMatch?.[1] && planMatch[2]) {
    const amount = Number(planMatch[1]);
    const unit = planMatch[2].toLowerCase();
    const minutes = Math.round(amount * (unit.startsWith('h') ? 60 : 1));
    if (minutes >= 15 && minutes <= 960) return { type: 'plan_day', availableMinutes: minutes, confidence: 1 };
  }
  if (/^(?:plan my day|plan my evening|organize my evening|organise my evening)$/i.test(command)
    || /(?:^|\.\s*)(?:organize|organise) my evening$/i.test(command)) {
    return { type: 'plan_day', availableMinutes: 240, confidence: 1 };
  }
  const naturalWindow = command.match(/^i have\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\s+(?:before|until)\b/i);
  if (naturalWindow?.[1] && naturalWindow[2]) {
    const amount = Number(naturalWindow[1]);
    const minutes = Math.round(amount * (naturalWindow[2].toLowerCase().startsWith('h') ? 60 : 1));
    if (minutes >= 15 && minutes <= 960) return { type: 'plan_day', availableMinutes: minutes, confidence: 1 };
  }

  const revision = parsePlanRevision(command);
  if (revision) return revision;
  const dependency = parseDependency(command);
  if (dependency) return dependency;

  if (/^(what should i do now|what do i do now|recommend a task)$/i.test(command)) {
    return { type: 'recommend_next_task', confidence: 1 };
  }
  if (/^(show|list) overdue tasks$/i.test(command)) {
    return { type: 'list_tasks', scope: 'overdue', confidence: 1 };
  }
  if (/^(what is|what's) due this week$/i.test(command)) {
    return { type: 'list_tasks', scope: 'week', confidence: 1 };
  }
  if (/^(show|list) (my )?tasks?( today| for today)$/i.test(command)) {
    return { type: 'list_tasks', scope: 'today', confidence: 1 };
  }
  if (/^(show|list) (my )?tasks?$/i.test(command)) {
    return { type: 'list_tasks', scope: 'all', confidence: 1 };
  }
  if (/^(show|list) (my )?projects$/i.test(command)) {
    return { type: 'list_projects', confidence: 1 };
  }

  const createProjectMatch = command.match(/^create project\s+(.+)$/i);
  if (createProjectMatch?.[1]) {
    return { type: 'create_project', projectName: createProjectMatch[1].trim(), confidence: 1 };
  }

  const createMatch = command.match(/^(?:add|create|new task)\s+(.+)$/i);
  if (createMatch?.[1]) {
    const { prefix, dateText } = extractTrailingDate(createMatch[1], now, options.timezone);
    const title = prefix.replace(/\s+(?:due|by|on|at)\s*$/i, '').trim();
    if (!title) return null;
    return dateText
      ? { type: 'create_task', title, dueText: dateText, confidence: 1 }
      : { type: 'create_task', title, confidence: 1 };
  }

  const moveMatch = command.match(/^move\s+(.+?)\s+to\s+(.+)$/i);
  if (moveMatch?.[1] && moveMatch[2]) {
    return { type: 'set_deadline', taskQuery: moveMatch[1].trim(), dueText: moveMatch[2].trim(), confidence: 1 };
  }
  const assignMatch = command.match(/^assign\s+(.+?)\s+to\s+(.+)$/i);
  if (assignMatch?.[1] && assignMatch[2]) {
    return { type: 'assign_project', taskQuery: assignMatch[1].trim(), projectName: assignMatch[2].trim(), confidence: 1 };
  }
  const priorityMatch = command.match(/^set priority of\s+(.+?)\s+to\s+(low|normal|high|urgent)$/i);
  if (priorityMatch?.[1] && priorityMatch[2]) {
    return {
      type: 'set_priority',
      taskQuery: priorityMatch[1].trim(),
      priority: priorityMatch[2].toLowerCase() as 'low' | 'normal' | 'high' | 'urgent',
      confidence: 1,
    };
  }
  const estimateMatch = command.match(/^(?:estimate|set duration of)\s+(.+?)\s+(?:for|to)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)$/i);
  if (estimateMatch?.[1] && estimateMatch[2] && estimateMatch[3]) {
    const amount = Number(estimateMatch[2]);
    const estimateMinutes = Math.round(amount * (estimateMatch[3].toLowerCase().startsWith('h') ? 60 : 1));
    if (estimateMinutes < 5 || estimateMinutes > 600) return null;
    return { type: 'set_estimate', taskQuery: estimateMatch[1].trim(), estimateMinutes, confidence: 1 };
  }

  const completeMatch = command.match(/^(?:complete|finish|mark complete)\s+(.+)$/i);
  if (completeMatch?.[1]) return { type: 'complete_task', taskQuery: completeMatch[1].trim(), confidence: 1 };
  const reopenMatch = command.match(/^reopen\s+(.+)$/i);
  if (reopenMatch?.[1]) return { type: 'reopen_task', taskQuery: reopenMatch[1].trim(), confidence: 1 };
  const deleteMatch = command.match(/^(?:delete|remove)\s+(.+)$/i);
  if (deleteMatch?.[1]) return { type: 'delete_task', taskQuery: deleteMatch[1].trim(), confidence: 1 };
  const restoreMatch = command.match(/^restore\s+(.+)$/i);
  if (restoreMatch?.[1]) return { type: 'restore_task', taskQuery: restoreMatch[1].trim(), confidence: 1 };
  const undoMatch = command.match(/^undo(?: last change to)?\s+(.+)$/i);
  if (undoMatch?.[1]) return { type: 'undo_last_change', taskQuery: undoMatch[1].trim(), confidence: 1 };
  if (/^what is due today$/i.test(command)) {
    return { type: 'list_tasks', scope: 'today', confidence: 1 };
  }
  if (/^today$/i.test(command) && localNow.isValid) {
    return { type: 'list_tasks', scope: 'today', confidence: 1 };
  }
  return null;
}

function extractTrailingDate(text: string, now: Date, timezone: string): { prefix: string; dateText: string | null } {
  const localNow = DateTime.fromJSDate(now, { zone: timezone });
  const results = chrono.parse(text, { instant: now, timezone: localNow.offset }, { forwardDate: true });
  const match = results.find((result) => result.index + result.text.length >= text.length - 1);
  if (!match) return { prefix: text, dateText: null };
  return {
    prefix: text.slice(0, match.index).trim(),
    dateText: match.text.trim(),
  };
}

/**
 * Recognises natural-language feedback on a proposed plan. These requests only
 * ever produce a new proposal; nothing is written until the user approves it.
 */
function parsePlanRevision(command: string): TaskIntent | null {
  // Covers "give me more time for DBMS", "add 45 minutes to DBMS", and
  // "give DBMS 2 hours", where the quantity may sit on either side of the task.
  const moreTime = command.match(
    /^(?:give|add|allocate)\s+(?:me\s+)?(?:an?\s+)?(?:extra\s+)?(?:(\d+)\s*(minutes?|mins?|hours?|hrs?)\s*)?(?:more\s+)?(?:time\s+)?(?:for\s+|to\s+)?(.+?)(?:\s+(\d+)\s*(minutes?|mins?|hours?|hrs?))?$/i,
  );
  if (moreTime?.[3]) {
    const focus = moreTime[3].trim();
    // "add <task>" is task creation, not a request for more time. Only treat this
    // as a revision when the user actually asked for extra time or named a task.
    const askedForTime = Boolean(moreTime[1] ?? moreTime[4] ?? /^(?:give|allocate)\b/i.test(command));
    const isTaskCreation = /^(?:create|new)\s+task\b/i.test(command) || (!askedForTime && /^(?:add)\b/i.test(command));
    if (isTaskCreation || !askedForTime) return null;
    const quantity = moreTime[1] ?? moreTime[4];
    const unit = (moreTime[2] ?? moreTime[5] ?? 'minutes').toLowerCase();
    const extraMinutes = Math.round(unit.startsWith('h') ? Number(quantity ?? 30) * 60 : Number(quantity ?? 30));
    return {
      type: 'revise_plan',
      focusTaskQuery: focus,
      extraMinutes: Math.min(600, Math.max(5, extraMinutes)),
      confidence: 1,
    };
  }
  const notBefore = command.match(/^(?:don'?t|do not|never)\s+schedule\s+(?:anything\s+)?(?:before|until)\s+(.+)$/i);
  if (notBefore?.[1]) {
    return { type: 'revise_plan', notBeforeText: notBefore[1].trim(), confidence: 1 };
  }
  const commitment = command.match(/^i (?:have|also have)\s+(?:a|an)?\s*(class|meeting|call|appointment|lecture)\s+(?:at|from)\s+(.+)$/i);
  if (commitment?.[1] && commitment[2]) {
    return {
      type: 'revise_plan',
      busyLabel: commitment[1].toLowerCase(),
      busyStartText: commitment[2].trim(),
      confidence: 1,
    };
  }
  return null;
}

/** Recognises "X depends on Y" and "X is independent of Y". */
function parseDependency(command: string): TaskIntent | null {
  const depends = command.match(/^(.+?)\s+(?:depends on|needs|must (?:come|be done) (?:after|before)|after)\s+(.+)$/i);
  if (depends?.[1] && depends[2]) {
    return { type: 'set_dependency', taskQuery: depends[1].trim(), dependsOnTaskQuery: depends[2].trim(), confidence: 1 };
  }
  const independent = command.match(/^(.+?)\s+(?:is\s+)?independent of\s+(.+)$/i);
  if (independent?.[1]) {
    return { type: 'set_dependency', taskQuery: independent[1].trim(), confidence: 1 };
  }
  return null;
}
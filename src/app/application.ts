import { DateTime } from 'luxon';
import type { AppConfig } from '../config/config.js';
import { OsCredentialStore, parseGeminiKeyCommand, validateGeminiApiKey, type CredentialStore } from '../config/credentialStore.js';
import { AIError, DatabaseError, UserError } from '../core/errors.js';
import { ProjectService } from '../core/projects/projectService.js';
import type { Task, TaskQuery } from '../core/tasks/task.js';
import { TaskService } from '../core/tasks/taskService.js';
import { DayPlanService } from '../core/agent/dayPlanService.js';
import type { DayPlan, PlanConstraints, ScheduleBlock } from '../core/agent/dayPlan.js';
import { SqliteConnection } from '../db/connection.js';
import { SqliteProjectRepository } from '../db/repositories/sqliteProjectRepository.js';
import { SqliteScheduleBlockRepository } from '../db/repositories/sqliteScheduleBlockRepository.js';
import { SqliteTaskRepository } from '../db/repositories/sqliteTaskRepository.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { Ax1Client } from '../ai/ax1Client.js';
import { GeminiClient, type IntentClient } from '../ai/client.js';
import type { TaskIntent } from '../ai/schema.js';
import { IntentInterpreter } from '../ai/interpreter.js';
import { validateIntent } from '../ai/validator.js';
import { formatTaskDate, parseNaturalDate } from '../utils/dates.js';
import { logError } from '../utils/logging.js';

export type TaskView = 'now' | 'next' | 'today' | 'week' | 'meetings' | 'deadlines';

export type RequestResult =
  | { status: 'done'; message: string }
  | { status: 'confirmation'; message: string; intent: TaskIntent; plan?: DayPlan }
  | { status: 'credential'; action: 'connect' | 'replace' | 'remove'; message: string }
  | { status: 'rejected'; message: string };

export class TaskFlowApplication {
  private acceptingWork = true;
  /** Window of the most recent proposal, so a revision can reuse it. */
  private lastPlanWindow: number | undefined;
  /** Accumulated user feedback, applied to the next proposal only. */
  private pendingConstraints: PlanConstraints = {};

  private constructor(
    private readonly config: AppConfig,
    private readonly connection: SqliteConnection,
    private readonly tasks: TaskService,
    private readonly projects: ProjectService,
    private interpreter: IntentInterpreter,
    private readonly credentialStore: CredentialStore,
    private activeGeminiApiKey: string | undefined,
    private readonly dayPlans: DayPlanService,
  ) {}

  get timezone(): string {
    return this.config.timezone;
  }

  /**
   * Current AI connection state for the status bar. Reports which backend is in
   * use and where its credential came from, without ever exposing the key.
   */
  get aiStatus(): { connected: boolean; source: 'environment' | 'keychain' | 'ax1-local' | 'none'; model: string } {
    if (this.config.geminiApiKey) {
      return { connected: true, source: 'environment', model: this.config.geminiModel };
    }
    if (this.activeGeminiApiKey) {
      return { connected: true, source: 'keychain', model: this.config.geminiModel };
    }
    if (this.interpreter.hasClient) {
      // No Gemini key, so the live client must be the local AX 1 fallback.
      return { connected: true, source: 'ax1-local', model: 'AX 1 (local)' };
    }
    return { connected: false, source: 'none', model: this.config.geminiModel };
  }

  projectName(projectId: string | null): string | null {
    return this.projects.projectName(projectId);
  }

  scheduleForToday(): ScheduleBlock[] {
    return this.dayPlans.scheduleForToday();
  }

  scheduleForPlan(planId: string): ScheduleBlock[] {
    return this.dayPlans.savedPlan(planId);
  }

  static open(
    config: AppConfig,
    aiClient?: IntentClient,
    credentialStore: CredentialStore = new OsCredentialStore(),
  ): TaskFlowApplication {
    const connection = new SqliteConnection(config.databasePath);
    try {
      const database = connection.open();
      const projectRepository = new SqliteProjectRepository(database);
      const repository = new SqliteTaskRepository(database);
      const scheduleRepository = new SqliteScheduleBlockRepository(database);
      const tasks = new TaskService(repository, undefined, undefined, projectRepository);
      const projects = new ProjectService(projectRepository, tasks);
      const dayPlans = new DayPlanService(
        tasks,
        scheduleRepository,
        config.timezone,
        undefined,
        undefined,
        (projectId) => projects.projectName(projectId),
      );
      const apiKey = config.geminiApiKey ?? credentialStore.getGeminiApiKey();
      const client = aiClient ?? createAiClient(config);
      const interpreter = new IntentInterpreter(client, config.timezone, config.confidenceThreshold);
      return new TaskFlowApplication(config, connection, tasks, projects, interpreter, credentialStore, apiKey, dayPlans);
    } catch (error) {
      try {
        connection.close();
      } catch (closeError) {
        throw new DatabaseError('TaskFlow initialization failed and the database could not be closed cleanly.', {
          cause: new AggregateError([error, closeError]),
        });
      }
      throw error;
    }
  }

  async interpretRequest(input: string, signal?: AbortSignal): Promise<RequestResult> {
    this.ensureAcceptingWork();
    const keyCommand = parseGeminiKeyCommand(input);
    if (keyCommand === 'connect') {
      if (this.config.geminiApiKey) return { status: 'done', message: 'GEMINI_API_KEY is configured in the environment; update that variable to change it.' };
      if (this.activeGeminiApiKey) return { status: 'done', message: 'Gemini is already connected. Use “replace api key” to update it.' };
      return { status: 'credential', action: 'connect', message: 'Enter the Gemini API key. Input is masked and saved to the OS credential store.' };
    }
    if (keyCommand === 'replace') {
      if (this.config.geminiApiKey) return { status: 'done', message: 'GEMINI_API_KEY is configured in the environment; update that variable to change it.' };
      return { status: 'credential', action: 'replace', message: 'Enter the replacement Gemini API key. The current key remains active unless the new key verifies.' };
    }
    if (keyCommand === 'remove') {
      return { status: 'credential', action: 'remove', message: 'Remove the saved Gemini API key? Type y to confirm.' };
    }

    const interpretation = await this.interpreter.interpret(input, signal);
    if (signal?.aborted) throw new UserError('Request cancelled.');
    if (interpretation.confidence === 'low') {
      return { status: 'rejected', message: 'I’m not confident enough to change anything. Please rephrase the request.' };
    }
    if (interpretation.intent.type === 'plan_day') {
      this.lastPlanWindow = interpretation.intent.availableMinutes;
      this.pendingConstraints = {};
      const plan = this.dayPlans.propose(interpretation.intent.availableMinutes);
      return { status: 'confirmation', message: this.dayPlans.format(plan), intent: interpretation.intent, plan };
    }
    if (interpretation.intent.type === 'revise_plan') {
      // A revision always regenerates a proposal from the last window; it never
      // edits the previous plan and never touches stored data.
      const window = interpretation.intent.availableMinutes ?? this.lastPlanWindow ?? 240;
      this.pendingConstraints = this.mergeConstraints(interpretation.intent);
      const plan = this.dayPlans.propose(window, this.pendingConstraints);
      return { status: 'confirmation', message: this.dayPlans.format(plan), intent: interpretation.intent, plan };
    }
    if (interpretation.requiresConfirmation) {
      return {
        status: 'confirmation',
        message: this.describeProposal(interpretation.intent),
        intent: interpretation.intent,
      };
    }
    return { status: 'done', message: this.executeIntent(interpretation.intent) };
  }

  confirmRequest(intent: TaskIntent, accepted: boolean, plan?: DayPlan): RequestResult {
    this.ensureAcceptingWork();
    if (!accepted) return { status: 'done', message: 'No changes made.' };
    const validated = validateIntent(intent);
    if (validated.confidence < 0.55) return { status: 'rejected', message: 'I’m not confident enough to change anything.' };
    if (validated.type === 'plan_day' || validated.type === 'revise_plan') {
      if (!plan) throw new UserError('The proposed plan is missing; create a fresh plan before applying.');
      const saved = this.dayPlans.apply(plan);
      // Constraints only shape proposals, so they are cleared once approved.
      this.pendingConstraints = {};
      const workCount = saved.filter((block) => block.kind === 'work').length;
      const breakCount = saved.filter((block) => block.kind === 'break').length;
      const schedule = this.dayPlans.formatApplied(saved);
      const recorded = plan.assumptions.length
        ? `\nRecorded ${plan.assumptions.length} assumed duration(s) so future plans do not guess again.`
        : '';
      return {
        status: 'done',
        message: `Plan applied and verified: ${workCount} work blocks and ${breakCount} break blocks saved.${recorded}${schedule ? `\n${schedule}` : ''}\nNo other tasks were modified.`,
      };
    }
    return { status: 'done', message: this.executeIntent(validated) };
  }

  tasksForView(view: TaskView): Task[] {
    const now = DateTime.now().setZone(this.config.timezone);
    switch (view) {
      case 'now': {
        const recommendation = this.tasks.recommendNextTask(now.toJSDate());
        return recommendation ? [recommendation.task] : [];
      }
      case 'next':
        return this.tasks.listTasks({ status: 'open', dueAfter: utcIso(now) }).slice(0, 8);
      case 'today':
        return this.tasks.listTasks({
          dueAfter: utcIso(now.startOf('day')),
          dueBefore: utcIso(now.endOf('day')),
        });
      case 'week':
        return this.tasks.listTasks({
          dueAfter: utcIso(now.startOf('week')),
          dueBefore: utcIso(now.endOf('week')),
        });
      case 'meetings':
        return [];
      case 'deadlines':
        return this.tasks.listTasks({ status: 'open', dueAfter: '0001-01-01T00:00:00.000Z' });
    }
  }

  recommendation(): { task: Task; reason: string } | null {
    return this.tasks.recommendNextTask();
  }

  close(): void {
    this.connection.close();
  }

  stopAccepting(): void {
    this.acceptingWork = false;
  }

  logError(error: unknown, additionalSecrets: readonly string[] = []): Promise<void> {
    return logError(error, [this.config.geminiApiKey, this.activeGeminiApiKey, ...additionalSecrets].filter((value): value is string => Boolean(value)));
  }

  async saveGeminiApiKey(input: string): Promise<string> {
    this.ensureAcceptingWork();
    if (this.config.geminiApiKey) throw new UserError('GEMINI_API_KEY is configured in the environment; update that variable to change it.');
    const apiKey = validateGeminiApiKey(input);
    const client = new GeminiClient(apiKey, this.config.geminiModel, this.config.aiTimeoutMs);
    // The key is only persisted after a successful round-trip. A model or
    // configuration problem must not look like a bad key, so the underlying
    // reason is preserved and the user is told nothing was stored.
    let validation;
    try {
      validation = validateIntent(await client.generate('Return exactly this JSON intent: {"type":"recommend_next_task","confidence":1}'));
    } catch (error) {
      throw error instanceof AIError
        ? new AIError(`${error.message} The key was not saved.`, { cause: error })
        : error;
    }
    if (validation.type !== 'recommend_next_task') throw new AIError('Gemini returned an unexpected response while validating the key. The key was not saved.');
    this.credentialStore.setGeminiApiKey(apiKey);
    this.activeGeminiApiKey = apiKey;
    this.interpreter = new IntentInterpreter(client, this.config.timezone, this.config.confidenceThreshold);
    return 'Gemini connected. The key was verified and saved to the OS credential store.';
  }

  removeGeminiApiKey(): string {
    this.ensureAcceptingWork();
    const removed = this.credentialStore.deleteGeminiApiKey();
    this.activeGeminiApiKey = this.config.geminiApiKey;
    // Rebuilding the client keeps the local AX 1 fallback in place when a Gemini
    // key is removed, so the user is not silently left with no AI at all.
    this.interpreter = new IntentInterpreter(
      this.activeGeminiApiKey
        ? new GeminiClient(this.activeGeminiApiKey, this.config.geminiModel, this.config.aiTimeoutMs)
        : createAiClient(this.config),
      this.config.timezone,
      this.config.confidenceThreshold,
    );
    if (this.config.geminiApiKey) return 'Saved Gemini key removed. GEMINI_API_KEY from the environment remains active.';
    if (!removed) return 'No saved Gemini API key was found.';
    return this.interpreter.hasClient
      ? 'Gemini API key removed from the OS credential store. TaskFlow will use the local AX 1 runtime instead.'
      : 'Gemini API key removed from the OS credential store. No AI backend is active.';
  }

  private executeIntent(intent: TaskIntent): string {
    switch (intent.type) {
      case 'create_task': {
        const dueAt = intent.dueText
          ? parseNaturalDate(intent.dueText, { timezone: this.config.timezone }).value
          : null;
        const task = this.tasks.createTask({ title: intent.title, dueAt });
        return `Created “${task.title}”${task.dueAt ? `, due ${formatTaskDate(task.dueAt, this.config.timezone)}` : ''}.`;
      }
      case 'list_tasks': {
        const tasks = intent.query
          ? this.tasks.searchTasks(intent.query, this.queryForScope(intent.scope))
          : this.tasks.listTasks(this.queryForScope(intent.scope));
        return formatTaskList(tasks, this.config.timezone, intent.scope, (projectId) => this.projects.projectName(projectId));
      }
      case 'complete_task': {
        const task = this.tasks.completeTask(this.resolveTask(intent.taskQuery).id);
        return `Completed “${task.title}”.`;
      }
      case 'reopen_task': {
        const task = this.tasks.reopenTask(this.resolveTask(intent.taskQuery).id);
        return `Reopened “${task.title}”.`;
      }
      case 'delete_task': {
        const task = this.tasks.deleteTask(this.resolveTask(intent.taskQuery).id);
        return `Deleted “${task.title}”. You can restore it from history.`;
      }
      case 'restore_task': {
        const selected = this.resolveTask(intent.taskQuery, true);
        const task = this.tasks.restoreTask(selected.id);
        return `Restored “${task.title}”.`;
      }
      case 'set_deadline': {
        const selected = this.resolveTask(intent.taskQuery);
        const dueAt = parseNaturalDate(intent.dueText, { timezone: this.config.timezone }).value;
        const task = this.tasks.setDeadline(selected.id, dueAt);
        return `Moved “${task.title}” to ${formatTaskDate(dueAt, this.config.timezone)}.`;
      }
      case 'set_priority': {
        const task = this.tasks.setPriority(this.resolveTask(intent.taskQuery).id, intent.priority);
        return `Set “${task.title}” to ${task.priority} priority.`;
      }
      case 'set_estimate': {
        const task = this.tasks.setEstimate(this.resolveTask(intent.taskQuery).id, intent.estimateMinutes);
        return `Estimated “${task.title}” at ${task.estimateMinutes} minutes.`;
      }
      case 'plan_day':
        throw new UserError('Create and approve a fresh plan before applying it.');
      case 'create_project': {
        const project = this.projects.createProject(intent.projectName);
        return `Created project “${project.name}”.`;
      }
      case 'assign_project': {
        const selected = this.resolveTask(intent.taskQuery);
        const task = this.projects.assignTask(selected.id, intent.projectName);
        return `Assigned “${task.title}” to “${intent.projectName}”.`;
      }
      case 'list_projects': {
        const projects = this.projects.listProjects();
        return projects.length ? projects.map((project) => project.name).join('\n') : 'No projects found.';
      }
      case 'recommend_next_task': {
        const recommendation = this.tasks.recommendNextTask();
        return recommendation
          ? `Do “${recommendation.task.title}” next. ${recommendation.reason}`
          : 'You have no open tasks. Add one when you’re ready.';
      }
      case 'undo_last_change': {
        const selected = this.resolveTask(intent.taskQuery, true);
        const task = this.tasks.undoLastChange(selected.id);
        return `Undid the last change to “${task.title}”.`;
      }
      case 'set_dependency': {
        const selected = this.resolveTask(intent.taskQuery);
        if (!intent.dependsOnTaskQuery) {
          const task = this.tasks.setDependency(selected.id, null);
          return `“${task.title}” no longer waits for another task.`;
        }
        const prerequisite = this.resolveTask(intent.dependsOnTaskQuery);
        const task = this.tasks.setDependency(selected.id, prerequisite.id);
        return `“${task.title}” now waits for “${prerequisite.title}”.`;
      }
      case 'revise_plan':
        // Reached only if a revision slipped past the confirmation gate, which
        // requiresConfirmation prevents. Planning never mutates from here.
        return 'No changes made. A revised plan must be confirmed before it is applied.';
    }
  }

  private ensureAcceptingWork(): void {
    if (!this.acceptingWork) throw new UserError('TaskFlow is shutting down and cannot accept new work.');
  }

  private queryForScope(scope: 'all' | 'today' | 'week' | 'overdue'): TaskQuery {
    const now = DateTime.now().setZone(this.config.timezone);
    if (scope === 'overdue') return { overdueAt: utcIso(now) };
    if (scope === 'today') {
      return {
        dueAfter: utcIso(now.startOf('day')),
        dueBefore: utcIso(now.endOf('day')),
      };
    }
    if (scope === 'week') {
      return {
        dueAfter: utcIso(now.startOf('week')),
        dueBefore: utcIso(now.endOf('week')),
      };
    }
    return {};
  }

  private resolveTask(query: string, includeDeleted = false): Task {
    const matches = this.tasks.searchTasks(query, { includeDeleted });
    if (matches.length === 0) throw new UserError(`I couldn't find a task matching “${query}”.`);
    const normalizedQuery = query.toLocaleLowerCase();
    const exact = matches.filter((task) => task.title.toLocaleLowerCase() === normalizedQuery);
    if (exact.length === 1) return exact[0]!;
    if (matches.length > 1) {
      const titles = matches.slice(0, 4).map((task) => `“${task.title}”`).join(', ');
      throw new UserError(`That matches more than one task: ${titles}. Use a more specific title.`);
    }
    const task = matches[0];
    if (!task) throw new AIError();
    return task;
  }

  /**
   * Folds a revision into the accumulated constraints. Earlier feedback is kept
   * so successive requests compose ("give DBMS more time" then "not before 10").
   */
  private mergeConstraints(intent: Extract<TaskIntent, { type: 'revise_plan' }>): PlanConstraints {
    const next: PlanConstraints = { ...this.pendingConstraints, extraMinutesByTaskId: { ...this.pendingConstraints.extraMinutesByTaskId } };
    if (intent.availableMinutes !== undefined) this.lastPlanWindow = intent.availableMinutes;
    if (intent.notBeforeText) {
      const parsed = parseNaturalDate(intent.notBeforeText, { timezone: this.config.timezone }).value;
      next.notBefore = parsed;
    }
    if (intent.extraMinutes !== undefined && intent.focusTaskQuery) {
      const task = this.resolveTask(intent.focusTaskQuery);
      const existing = next.extraMinutesByTaskId?.[task.id] ?? 0;
      next.extraMinutesByTaskId = { ...next.extraMinutesByTaskId, [task.id]: existing + intent.extraMinutes };
    }
    if (intent.busyLabel && intent.busyStartText) {
      const start = parseNaturalDate(intent.busyStartText, { timezone: this.config.timezone }).value;
      const end = new Date(Date.parse(start) + 60 * 60_000).toISOString();
      next.busyIntervals = [...(next.busyIntervals ?? []), { label: intent.busyLabel, startsAt: start, endsAt: end }];
    }
    return next;
  }

  private describeProposal(intent: TaskIntent): string {
    switch (intent.type) {
      case 'delete_task': return `Delete the task matching “${intent.taskQuery}”? Type y to confirm.`;
      case 'create_task': return `Create “${intent.title}”${intent.dueText ? `, due ${intent.dueText}` : ''}? Type y to confirm.`;
      case 'set_dependency': return intent.dependsOnTaskQuery
        ? `Make “${intent.taskQuery}” wait for “${intent.dependsOnTaskQuery}”? Type y to confirm.`
        : `Remove the dependency on “${intent.taskQuery}”? Type y to confirm.`;
      case 'revise_plan': return 'Regenerate the plan with this change? Type y to confirm, e to revise again, or n to cancel.';
      default: return `Proceed with ${intent.type.replaceAll('_', ' ')}? Type y to confirm.`;
    }
  }
}

function formatTaskList(tasks: Task[], timezone: string, scope: string, projectName: (projectId: string | null) => string | null): string {
  if (!tasks.length) return `No tasks found for ${scope}.`;
  return tasks.map((task) => {
    const deadline = task.dueAt ? ` · ${formatTaskDate(task.dueAt, timezone)}` : '';
    const status = task.status === 'completed' ? '✓' : '○';
    const project = projectName(task.projectId);
    return `${status} [${task.priority}] ${task.title}${project ? ` · ${project}` : ''}${deadline}`;
  }).join('\n');
}

/**
 * Chooses the AI backend for this session.
 *
 * `auto` prefers Gemini when a key is available and otherwise falls back to a
 * local AX 1 runtime, so interpretation and planning keep working offline.
 * Returning `undefined` leaves the deterministic command set working with no AI
 * at all, rather than failing startup.
 */
function createAiClient(config: AppConfig): IntentClient | undefined {
  const geminiAvailable = Boolean(config.geminiApiKey);
  const preference = config.aiProvider;

  if (preference === 'none') return undefined;

  if (preference === 'gemini') {
    return geminiAvailable
      ? new GeminiClient(config.geminiApiKey!, config.geminiModel, config.aiTimeoutMs)
      : undefined;
  }

  if (preference === 'ax1') {
    return isAx1Available(config.ax1Binary)
      ? new Ax1Client(prepareAx1Directory(config.ax1WorkingDirectory), config.ax1Binary)
      : undefined;
  }

  // auto: Gemini first, then the local fallback.
  if (geminiAvailable) return new GeminiClient(config.geminiApiKey!, config.geminiModel, config.aiTimeoutMs);
  if (isAx1Available(config.ax1Binary)) {
    return new Ax1Client(prepareAx1Directory(config.ax1WorkingDirectory), config.ax1Binary);
  }
  return undefined;
}

/**
 * Ensures AX 1 has a private directory to work in.
 *
 * Keeping it away from the folder that holds the database means a local model
 * has no path to user data even if a tool were somehow reached. The directory is
 * owner-only, matching TaskFlow's other data paths.
 */
function prepareAx1Directory(directory: string): string {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  } catch {
    return tmpdir();
  }
}

/**
 * Reports whether the `ax1` executable can be run.
 *
 * A bare name is resolved through PATH, so every candidate extension is checked
 * rather than assuming a single platform layout.
 */
export function isAx1Available(binary: string): boolean {
  if (binary.includes('/')) return canExecute(binary);
  const pathEntries = (process.env['PATH'] ?? '').split(':').filter(Boolean);
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return pathEntries.some((entry) => extensions.some((extension) => canExecute(join(entry, binary + extension))));
}

function canExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function utcIso(date: DateTime): string {
  const value = date.toUTC().toISO();
  if (!value) throw new UserError('TaskFlow could not calculate the requested date range.');
  return value;
}
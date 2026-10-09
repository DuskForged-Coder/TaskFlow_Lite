import { AIError, TaskFlowError, UserError } from '../core/errors.js';
import { parseCommand } from '../commands/commandParser.js';
import type { TaskIntent } from './schema.js';
import { confidenceBand, requiresConfirmation, validateIntent, type ConfidenceBand } from './validator.js';
import type { IntentClient } from './client.js';

export interface Interpretation {
  intent: TaskIntent;
  confidence: ConfidenceBand;
  requiresConfirmation: boolean;
}

export class IntentInterpreter {
  constructor(
    private readonly client: IntentClient | undefined,
    private readonly timezone: string,
    private readonly confidenceThreshold = 0.8,
  ) {}

  /** Whether an AI backend is attached, used for the status bar. */
  get hasClient(): boolean {
    return this.client !== undefined;
  }

  async interpret(input: string, signal?: AbortSignal): Promise<Interpretation> {
    const request = input.trim();
    if (!request) throw new UserError('Enter a command or request.');
    if (request.length > 4000) throw new UserError('Requests must be 4000 characters or fewer.');
    if (/^remind\s+me\b/i.test(request)) throw new UserError('Reminders are not available yet; TaskFlow will not pretend to send one.');

    const localIntent = parseCommand(request, { timezone: this.timezone });
    const intent = localIntent ?? await this.interpretWithAI(request, signal);
    const band = confidenceBand(intent.confidence, this.confidenceThreshold);
    return { intent, confidence: band, requiresConfirmation: requiresConfirmation(intent, band) };
  }

  private async interpretWithAI(request: string, signal?: AbortSignal): Promise<TaskIntent> {
    if (!this.client) throw new UserError('I could not match that to a supported command. Try “add …”, “show my tasks today”, or “complete …”.');
    try {
      return validateIntent(await this.client.generate(request, signal));
    } catch (error) {
      if (error instanceof TaskFlowError) throw error;
      throw new AIError();
    }
  }
}
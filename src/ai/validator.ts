import { AIError } from '../core/errors.js';
import { intentSchema, type TaskIntent } from './schema.js';

export function validateIntent(value: unknown): TaskIntent {
  const result = intentSchema.safeParse(value);
  if (!result.success) throw new AIError();
  return result.data;
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

export function confidenceBand(confidence: number, threshold = 0.8): ConfidenceBand {
  if (confidence >= threshold) return 'high';
  if (confidence >= 0.55) return 'medium';
  return 'low';
}

export function requiresConfirmation(intent: TaskIntent, band: ConfidenceBand): boolean {
  return band === 'medium' || intent.type === 'delete_task' || intent.type === 'plan_day'
    || intent.type === 'revise_plan' || intent.type === 'set_dependency';
}
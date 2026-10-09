import { describe, expect, it, vi } from 'vitest';
import { AIError, UserError } from '../src/core/errors.js';
import { IntentInterpreter } from '../src/ai/interpreter.js';
import { confidenceBand, requiresConfirmation, validateIntent } from '../src/ai/validator.js';
import type { TaskIntent } from '../src/ai/schema.js';

describe('AI intent validation and confidence', () => {
  it('accepts valid intent and rejects malformed, missing, and unknown fields', () => {
    const valid: TaskIntent = { type: 'create_task', title: 'Submit report', confidence: 0.95 };
    expect(validateIntent(valid)).toEqual(valid);
    expect(() => validateIntent({ type: 'create_task', confidence: 0.9 })).toThrow(AIError);
    expect(() => validateIntent({ type: 'run_shell', command: 'rm -rf', confidence: 1 })).toThrow(AIError);
    expect(() => validateIntent({ ...valid, confidence: 3 })).toThrow(AIError);
    expect(() => validateIntent({ ...valid, title: 'x'.repeat(201) })).toThrow(AIError);
  });

  it('distinguishes high, medium, and low confidence and confirms destructive requests', () => {
    expect(confidenceBand(0.91)).toBe('high');
    expect(confidenceBand(0.7)).toBe('medium');
    expect(confidenceBand(0.2)).toBe('low');
    expect(requiresConfirmation({ type: 'delete_task', taskQuery: 'old task', confidence: 1 }, 'high')).toBe(true);
    expect(requiresConfirmation({ type: 'create_task', title: 'new task', confidence: 0.7 }, 'medium')).toBe(true);
    expect(requiresConfirmation({ type: 'create_task', title: 'new task', confidence: 0.2 }, 'low')).toBe(false);
  });

  it('uses deterministic commands without calling AI and blocks unsupported reminders', async () => {
    const generate = vi.fn();
    const interpreter = new IntentInterpreter({ generate }, 'UTC');
    await expect(interpreter.interpret('add finish DBMS assignment tomorrow'))
      .resolves.toMatchObject({ intent: { type: 'create_task', title: 'finish DBMS assignment', dueText: 'tomorrow' }, confidence: 'high' });
    expect(generate).not.toHaveBeenCalled();
    await expect(interpreter.interpret('remind me about the presentation at 7pm')).rejects.toThrow(UserError);
    expect(generate).not.toHaveBeenCalled();
  });

  it('validates Gemini output before exposing an intent', async () => {
    const interpreter = new IntentInterpreter({ generate: async () => ({ type: 'delete_task', taskQuery: 'report', confidence: 0.7 }) }, 'UTC');
    await expect(interpreter.interpret('please remove the report task'))
      .resolves.toMatchObject({ confidence: 'medium', requiresConfirmation: true });
    const malformed = new IntentInterpreter({ generate: async () => ({ type: 'run_shell', confidence: 1 }) }, 'UTC');
    await expect(malformed.interpret('do something odd')).rejects.toThrow(AIError);
  });

  it('does not invent an interpretation when AI is unconfigured', async () => {
    await expect(new IntentInterpreter(undefined, 'UTC').interpret('something ambiguous'))
      .rejects.toThrow('I could not match that to a supported command.');
  });
});
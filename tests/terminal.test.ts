import { describe, expect, it } from 'vitest';
import {
  createHistory,
  editLine,
  HELP_LINES,
  KEY_HINTS,
  maskCredentialInput,
  parseConfirmationAnswer,
  recordHistory,
  sanitizeTerminalText,
  stepHistory,
} from '../src/utils/terminal.js';

describe('sanitizeTerminalText', () => {
  it('removes ANSI escapes, control characters, and bidi overrides', () => {
    expect(sanitizeTerminalText('\u001B[31mred\u001B[0m\u001B]52;c;payload\u0007\u202Etask'))
      .toBe('redtask');
  });

  it('masks API key input without exposing any key characters', () => {
    const secret = 'AIza-sensitive-test-value';
    expect(maskCredentialInput(secret)).toBe('*'.repeat(secret.length));
    expect(maskCredentialInput(secret)).not.toContain(secret);
  });
});

describe('parseConfirmationAnswer', () => {
  it.each(['y', 'Y', 'yes', 'YES', ' yes ', 'y.'])('applies only on an explicit yes (%s)', (input) => {
    expect(parseConfirmationAnswer(input)).toBe('apply');
  });

  it.each([
    'looks good',
    'okay',
    'ok',
    'nice',
    "that's fine",
    'continue',
    'sounds good',
    'go ahead',
    'yep',
    'sure',
    '',
  ])('never treats an ambiguous acknowledgement as approval (%s)', (input) => {
    expect(parseConfirmationAnswer(input)).toBe('decline');
  });

  it('offers revision only for an explicit e', () => {
    expect(parseConfirmationAnswer('e')).toBe('revise');
    expect(parseConfirmationAnswer('edit')).toBe('decline');
  });
});

describe('editLine', () => {
  it('clears the whole line so a pasted value can be retried quickly', () => {
    expect(editLine('a very long pasted api key', 'clear')).toBe('');
  });

  it('deletes one character on backspace', () => {
    expect(editLine('plan my day', 'backspace')).toBe('plan my da');
    expect(editLine('', 'backspace')).toBe('');
  });

  it('deletes the trailing word and its separating space', () => {
    expect(editLine('add finish DBMS assignment', 'deleteWord')).toBe('add finish DBMS');
    expect(editLine('DBMS', 'deleteWord')).toBe('');
    expect(editLine('', 'deleteWord')).toBe('');
  });
});

describe('command history', () => {
  it('walks backwards through submitted commands', () => {
    let state = createHistory();
    state = recordHistory(state, 'add DBMS');
    state = recordHistory(state, 'plan my day');

    const first = stepHistory(state, 'older');
    expect(first.value).toBe('plan my day');
    const second = stepHistory(first.state, 'older');
    expect(second.value).toBe('add DBMS');
    // Stops at the oldest entry instead of wrapping around.
    expect(stepHistory(second.state, 'older').value).toBe('add DBMS');
  });

  it('returns to the in-progress draft when walking past the newest entry', () => {
    let state = createHistory();
    state = recordHistory(state, 'add DBMS');
    const withDraft = { ...state, draft: 'half typed comm' };

    const older = stepHistory(withDraft, 'older');
    expect(older.value).toBe('add DBMS');
    const newer = stepHistory(older.state, 'newer');
    expect(newer.value).toBe('half typed comm');
    expect(newer.state.cursor).toBe(-1);
  });

  it('ignores blank and consecutive duplicate commands', () => {
    let state = createHistory();
    state = recordHistory(state, '   ');
    expect(state.entries).toEqual([]);
    state = recordHistory(state, 'add DBMS');
    state = recordHistory(state, 'add DBMS');
    expect(state.entries).toEqual(['add DBMS']);
  });

  it('caps stored history at the limit', () => {
    let state = createHistory();
    for (let index = 0; index < 10; index += 1) state = recordHistory(state, `command ${index}`, 3);
    expect(state.entries).toEqual(['command 7', 'command 8', 'command 9']);
  });

  it('is a no-op when there is nothing to recall', () => {
    const state = createHistory();
    expect(stepHistory(state, 'older').value).toBe('');
    expect(stepHistory(state, 'newer').value).toBe('');
  });
});

describe('discoverability', () => {
  it('advertises the key bindings users need to find', () => {
    expect(KEY_HINTS).toContain('Tab');
    expect(KEY_HINTS).toContain('history');
    expect(KEY_HINTS).toContain('help');
  });

  it('documents planning, including that nothing is saved without confirmation', () => {
    expect(HELP_LINES.join('\n')).toContain('plan my day');
    expect(HELP_LINES.join('\n')).toContain('until you confirm');
  });
});
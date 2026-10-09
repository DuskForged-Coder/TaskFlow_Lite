const ansiEscape = /\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[PX^_][\s\S]*?\u001B\\)/g;

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(ansiEscape, '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '');
}

export function maskCredentialInput(value: string): string {
  return '*'.repeat(Math.min(value.length, 48));
}

export type ConfirmationAnswer = 'apply' | 'revise' | 'decline';

/**
 * Interprets a reply at a confirmation prompt.
 *
 * Only an explicit "y" or "yes" authorises a change. Replies that merely sound
 * approving — "looks good", "okay", "nice", "sounds good", "continue" — are
 * treated as declining, because a proposal must never be applied on the strength
 * of an ambiguous acknowledgement.
 */
export function parseConfirmationAnswer(input: string): ConfirmationAnswer {
  const normalized = input.trim().toLowerCase().replace(/[?!.]+$/, '');
  if (normalized === 'y' || normalized === 'yes') return 'apply';
  if (normalized === 'e') return 'revise';
  return 'decline';
}

/** How a message should be presented. Errors must never look like success. */
export type MessageTone = 'success' | 'error' | 'warning' | 'info';

export interface HistoryState {
  /** Submitted commands, oldest first. */
  entries: readonly string[];
  /** Index into `entries`, or -1 when the user is editing a fresh line. */
  cursor: number;
  /** Text typed before history navigation began, restored on the way back down. */
  draft: string;
}

/** Starts a fresh history for a new session. */
export function createHistory(): HistoryState {
  return { entries: [], cursor: -1, draft: '' };
}

/** Records a submitted command, skipping blanks and consecutive duplicates. */
export function recordHistory(state: HistoryState, command: string, limit = 50): HistoryState {
  const entry = command.trim();
  if (!entry) return state;
  if (state.entries[state.entries.length - 1] === entry) return { ...state, cursor: -1, draft: '' };
  return { entries: [...state.entries, entry].slice(-limit), cursor: -1, draft: '' };
}

/**
 * Walks command history. Going up from a fresh line stashes the current text so
 * it can be restored when the user walks back past the newest entry.
 */
export function stepHistory(state: HistoryState, direction: 'older' | 'newer'): { state: HistoryState; value: string } {
  const { entries, cursor, draft } = state;
  if (entries.length === 0) return { state, value: draft };

  if (direction === 'older') {
    const next = cursor < 0 ? entries.length - 1 : Math.max(0, cursor - 1);
    return {
      state: { entries, cursor: next, draft: cursor < 0 ? draft : state.draft },
      value: entries[next] ?? draft,
    };
  }

  if (cursor < 0) return { state, value: draft };
  const next = cursor + 1;
  if (next >= entries.length) {
    // Past the newest entry: return to the line the user was typing.
    return { state: { entries, cursor: -1, draft }, value: draft };
  }
  return { state: { entries, cursor: next, draft }, value: entries[next] ?? draft };
}

/**
 * Applies a line-editing key to the current input.
 *
 * Exposed as a pure function so clearing or trimming a long pasted value is
 * testable without a terminal, and so paste never has to be corrected one
 * character at a time.
 */
export function editLine(value: string, action: 'backspace' | 'deleteWord' | 'clear'): string {
  if (action === 'clear') return '';
  if (action === 'backspace') return value.slice(0, -1);
  return value.replace(/\s*\S+$/, '');
}

/** Key hints shown in the footer so the interface is discoverable. */
export const KEY_HINTS = 'Tab view · ↑↓ history · ? help · Ctrl+U clear · Ctrl+C quit';

export const HELP_LINES: readonly string[] = [
  'Views',
  '  Tab / Shift+Tab   cycle views',
  '',
  'Editing',
  '  ↑ / ↓             recall previous commands',
  '  Ctrl+U            clear the line',
  '  Ctrl+W            delete the last word',
  '  Esc               cancel a prompt or stop working',
  '',
  'Planning',
  '  plan my day       propose a schedule (nothing is saved until you confirm)',
  '  y / n / e         apply, decline, or revise a proposal',
  '  estimate <task> for 45 minutes   give a task a duration',
  '',
  'Tasks',
  '  add <task> [when]  create a task',
  '  show my tasks today / show overdue tasks',
  '  complete <task> · reopen <task> · delete <task> · undo <task>',
  '  set priority of <task> to high',
  '  create project <name> · assign <task> to <project>',
  '',
  'AI',
  '  add AI            connect a Gemini key (stored in the OS keychain)',
  '  replace API key   swap the saved key',
  '  remove API key    delete the saved key',
];
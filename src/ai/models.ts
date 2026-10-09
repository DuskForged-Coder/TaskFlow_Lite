/**
 * Gemini model guidance.
 *
 * Google retires models on its own schedule and a retired endpoint starts
 * returning errors, so the default is kept in one place and referenced by both
 * the configuration loader and the AI client's error messages.
 */

/** Default model used when `GEMINI_MODEL` is not set. */
export const RECOMMENDED_MODEL = 'gemini-3.8-flash';

/**
 * Models Google has already retired. These get a clearer message than a generic
 * "not found" because the cause is a known lifecycle event rather than a typo in
 * `GEMINI_MODEL`.
 */
export const KNOWN_UNSUPPORTED_MODELS: ReadonlySet<string> = new Set([
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
]);

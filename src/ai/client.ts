import { AIError, NetworkError } from '../core/errors.js';
import { KNOWN_UNSUPPORTED_MODELS, RECOMMENDED_MODEL } from './models.js';

export interface IntentClient {
  generate(prompt: string, signal?: AbortSignal): Promise<unknown>;
}
/**
 * A retryable service failure. The status is retained so that, once retries are
 * exhausted, the caller can report the real cause instead of a generic outage.
 * This is internal control flow and never surfaces to the user directly.
 */
class TransientServiceError extends Error {
  constructor(readonly status: number) {
    super(`Transient AI service response: ${status}`);
    this.name = 'TransientServiceError';
  }
}

export class GeminiClient implements IntentClient {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  generate(prompt: string, signal?: AbortSignal): Promise<unknown> {
    if (prompt.length > 4000) return Promise.reject(new AIError('Requests must be 4000 characters or fewer.'));
    const key = `${this.model}:${prompt}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const request = this.requestWithRetry(prompt, signal);
    this.inFlight.set(key, request);
    void request.finally(() => this.inFlight.delete(key)).catch(() => undefined);
    return request;
  }

  private async requestWithRetry(prompt: string, signal?: AbortSignal): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (signal?.aborted) throw new AIError('Request cancelled.');
      try {
        return await this.request(prompt, signal);
      } catch (error) {
        lastError = error;
        if (error instanceof AIError || signal?.aborted || attempt === 2) break;
        await delay(250 * (2 ** attempt), signal);
      }
    }
    if (signal?.aborted) throw new AIError('Request cancelled.');
    if (lastError instanceof AIError) throw lastError;
    // Retries exhausted: a rate limit is a quota problem, not a generic outage,
    // so the original status is carried into the user-facing message.
    if (lastError instanceof TransientServiceError && lastError.status === 429) {
      throw new NetworkError('Gemini rate limit or quota reached. Wait a moment or check the quota for this key in Google AI Studio.', { cause: lastError });
    }
    throw new NetworkError(undefined, { cause: lastError });
  }

  private async request(prompt: string, externalSignal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), this.timeoutMs);
    const abortFromCaller = () => controller.abort(new Error('Request cancelled'));
    externalSignal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`);
      endpoint.searchParams.set('key', this.apiKey);
      const response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INTENT_INSTRUCTIONS }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      });
      if (response.status === 429 || response.status >= 500) throw new TransientServiceError(response.status);
      if (!response.ok) throw new AIError(await describeGeminiFailure(response, this.model, this.apiKey));
      return extractResponseText(await response.json() as unknown);
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (controller.signal.aborted) {
        if (externalSignal?.aborted) throw new AIError('Request cancelled.');
        throw new NetworkError('The AI request timed out.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

export const INTENT_INSTRUCTIONS = 'Interpret the user request for a terminal productivity assistant. Return one JSON object with type create_task(title,dueText?), list_tasks(scope,query?), complete_task(taskQuery), reopen_task(taskQuery), delete_task(taskQuery), restore_task(taskQuery), set_deadline(taskQuery,dueText), set_priority(taskQuery,priority), set_estimate(taskQuery,estimateMinutes), plan_day(availableMinutes), revise_plan(availableMinutes?,focusTaskQuery?,extraMinutes?,notBeforeText?,busyLabel?,busyStartText?), set_dependency(taskQuery,dependsOnTaskQuery?), create_project(projectName), assign_project(taskQuery,projectName), list_projects(), recommend_next_task(), or undo_last_change(taskQuery). Use plan_day for a request to plan or schedule the day; for “plan my day/evening” use 240 minutes. Use revise_plan only when the user is changing a plan that was already proposed: extraMinutes is how much MORE time to give focusTaskQuery, notBeforeText is a time to start no earlier than, and busyLabel with busyStartText describes a commitment to keep clear. Use set_dependency when the user says one task must follow, need, or come after another; omit dependsOnTaskQuery to remove the dependency. Never invent task durations; only propose planning requests, never schedule actions. Include confidence from 0 to 1. Never return IDs, code, commands, file paths, database instructions, or extra properties. Do not invent task details. If unclear, use low confidence.';

function extractResponseText(value: unknown): unknown {
  const candidates = getProperty(value, 'candidates');
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  const content = getProperty(first, 'content');
  const parts = getProperty(content, 'parts');
  const firstPart = Array.isArray(parts) ? parts[0] : undefined;
  const text = getProperty(firstPart, 'text');
  if (typeof text !== 'string') throw new AIError();
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new AIError(undefined, { cause });
  }
}

function getProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  return Reflect.get(value, key) as unknown;
}

/**
 * Turns a Gemini error response into an actionable message.
 *
 * The service reports very different problems behind the same status codes, and
 * the key itself must never reach the message, so only whitelisted fragments of
 * the response body are used to choose the wording.
 */
async function describeGeminiFailure(response: Response, model: string, apiKey: string): Promise<string> {
  const detail = await readErrorDetail(response, apiKey);
  const suffix = detail.reason ? ` (${detail.reason})` : '';

  if (/API_KEY_INVALID|API key not valid/i.test(detail.text)) {
    return 'Gemini rejected this API key. Create a new key in Google AI Studio and connect again.';
  }
  if (response.status === 404 || /not found|is not found for API version|models\//i.test(detail.text)) {
    const known = KNOWN_UNSUPPORTED_MODELS.has(model)
      ? `The configured model “${model}” has been retired by Google. `
      : `The model “${model}” was not found. `;
    return `${known}Set GEMINI_MODEL to a current model such as “${RECOMMENDED_MODEL}” and try again.`;
  }
  if (response.status === 403 || /PERMISSION_DENIED/i.test(detail.reason)) {
    return `Gemini denied the request${suffix}. ${explainDenial(detail.text)}`;
  }
  // Note: 429 and 5xx are handled as retryable before this point, so they never
  // reach here; they are reported by requestWithRetry once retries are exhausted.
  if (response.status === 400) {
    return `Gemini rejected the request${suffix}. Check GEMINI_MODEL and the key’s enabled APIs.`;
  }
  if (response.status >= 500) {
    return `The Gemini service is temporarily unavailable${suffix}. Try again shortly.`;
  }
  return `The AI service rejected the request${suffix}. Check the API key and model configuration.`;
}

/**
 * A 403 means the key itself is good but the project behind it cannot make this
 * call. The causes need different fixes, so they are told apart here.
 */
function explainDenial(text: string): string {
  if (/has not been used in project|is disabled|API has not been used|SERVICE_DISABLED/i.test(text)) {
    return 'Enable the Generative Language API for that project in the Google Cloud Console, wait a minute, then connect again.';
  }
  if (/reported as leaked|key was reported|blocked/i.test(text)) {
    return 'Google has blocked this key as publicly exposed. Create a new key in Google AI Studio and connect again.';
  }
  if (/location is not supported|unsupported country|not available in your region|regional/i.test(text)) {
    return 'The Gemini API is not available from this region. Check the supported-regions list for the Gemini API.';
  }
  if (/billing|billing status|free tier/i.test(text)) {
    return 'This project needs billing enabled. Link it to a billing account in the Google Cloud Console.';
  }
  return 'Check that the Generative Language API is enabled for the project behind this key, or create a fresh key in Google AI Studio.';
}

/** Reads the safe, non-secret parts of a Google API error body. */
async function readErrorDetail(response: Response, apiKey: string): Promise<{ text: string; reason: string }> {
  let text = '';
  let status = '';
  try {
    const body = await response.json() as unknown;
    const error = getProperty(body, 'error');
    const message = getProperty(error, 'message');
    if (typeof message === 'string') text = message;
    // The canonical status is a sibling field, not part of the message text.
    const statusField = getProperty(error, 'status');
    if (typeof statusField === 'string') status = statusField;
  } catch {
    text = '';
  }
  // Defence in depth: the key can legitimately appear in a URL echoed back by
  // the service, so it is stripped before the text is matched or surfaced.
  if (apiKey) text = text.split(apiKey).join('[redacted]');
  // The status field is a fixed enum (INVALID_ARGUMENT, PERMISSION_DENIED, ...)
  // and never contains request data, so it is safe to surface.
  const known = /^(INVALID_ARGUMENT|PERMISSION_DENIED|NOT_FOUND|RESOURCE_EXHAUSTED|UNAUTHENTICATED|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|FAILED_PRECONDITION)$/;
  const reason = known.test(status) ? status : known.exec(text)?.[1] ?? '';
  return { text, reason };
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AIError('Request cancelled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
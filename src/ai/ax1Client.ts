import { execFile } from 'node:child_process';
import { AIError, NetworkError } from '../core/errors.js';
import { INTENT_INSTRUCTIONS, type IntentClient } from './client.js';

/**
 * AX 1 (ARYAVAX) is a local intelligence runtime backed by Ollama. It acts as an
 * offline fallback when no Gemini key is configured, so interpretation and
 * planning keep working with no API key, no quota, and no network egress.
 *
 * Security: AX 1 exposes file, network, and code-execution tools by default. This
 * client depends on the locked-down profile in `.ax1/config.json`, which denies
 * every such tool, and runs in a dedicated directory that holds no TaskFlow
 * data. Output is untrusted: only JSON inside the response box is ever parsed,
 * and it must still pass `validateIntent` before anything is acted on.
 */

/** Wall-clock limit for a single AX 1 call. Local models can be slow on first use. */
const AX1_TIMEOUT_MS = 45_000;

/**
 * The subset of `execFile` this client relies on.
 *
 * Narrowing the dependency keeps the runtime seam easy to fake in tests without
 * inheriting `execFile`'s `__promisify__` overloads.
 */
export type Ax1Runner = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => { kill: (signal?: string) => boolean };

export interface Ax1ClientOptions {
  /** Path to the `ax1` executable. */
  binary?: string;
  /**
   * Directory AX 1 runs in. It must not contain the TaskFlow database or any
   * user data; AX 1 creates a `workspace/` here for its own scratch files.
   */
  workingDirectory?: string;
  /** Injected in tests to avoid spawning a real process. */
  runner?: typeof execFile;
}

export class Ax1Client implements IntentClient {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly workingDirectory: string,
    private readonly binary = 'ax1',
    private readonly runner: Ax1Runner = execFile as unknown as Ax1Runner,
  ) {}

  generate(prompt: string, signal?: AbortSignal): Promise<unknown> {
    if (prompt.length > 4000) return Promise.reject(new AIError('Requests must be 4000 characters or fewer.'));
    const existing = this.inFlight.get(prompt);
    if (existing) return existing;

    const request = this.ask(prompt, signal);
    this.inFlight.set(prompt, request);
    void request.finally(() => this.inFlight.delete(prompt)).catch(() => undefined);
    return request;
  }

  private ask(prompt: string, signal?: AbortSignal): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      // An abort must reject on its own; relying on the process callback alone
      // would leave the caller waiting forever if the child never exits.
      const onAbort = () => {
        child.kill('SIGTERM');
        reject(new AIError('Request cancelled.'));
      };
      if (signal?.aborted) {
        reject(new AIError('Request cancelled.'));
        return;
      }
      // execFile is used instead of exec so prompt text is never passed through a
      // shell, which would allow argument injection from user-supplied content.
      const child = this.runner(
        this.binary,
        ['ask', '--no-stream', `${INTENT_INSTRUCTIONS}\n\nUser request: ${prompt}`],
        { cwd: this.workingDirectory, timeout: AX1_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (signal?.aborted) return;
          if (error) {
            reject(new NetworkError(
              'The local AX 1 runtime could not answer. Check that `ax1` is installed and its model is available.',
            ));
            return;
          }
          const json = extractAx1Json(stdout);
          if (json === undefined) {
            reject(new AIError('The local AX 1 runtime did not return a usable JSON intent.'));
            return;
          }
          resolve(json);
        },
      );
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/**
 * Extracts the JSON intent from AX 1 output.
 *
 * The CLI decorates stdout with a progress trace and a bordered response box, so
 * the raw stream is never valid JSON. Only text inside the box is considered,
 * which keeps progress output and stray prose out of the parser. Returns
 * `undefined` rather than guessing when nothing parseable is present.
 */
export function extractAx1Json(output: string): unknown {
  const text = output.replace(/\r\n/g, '\n');
  // The response is wrapped in box-drawing borders; take the first enclosed block.
  const boxed = /[╭┌][^\n]*\n([\s\S]*?)\n[╰└][^\n]*/.exec(text);
  const body = boxed?.[1] ?? text;

  // Remove the box's vertical edges and padding from each line.
  const cleaned = body
    .split('\n')
    .map((line) => line.replace(/^│\s?/, '').replace(/\s?│$/, ''))
    .join('\n')
    .trim();

  // Tolerate a model that wraps its answer in a code fence.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(cleaned);
  const candidate = (fenced?.[1] ?? cleaned).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}
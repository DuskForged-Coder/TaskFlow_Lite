import { describe, expect, it, vi } from 'vitest';
import { AIError, NetworkError } from '../src/core/errors.js';
import { GeminiClient } from '../src/ai/client.js';
import { RECOMMENDED_MODEL } from '../src/ai/models.js';

const intent = { type: 'create_task', title: 'Submit report', confidence: 0.94 };

function response(status: number, text = JSON.stringify(intent)): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });
}

/** Builds a Gemini-style error response body, as returned by the real API. */
function errorResponse(status: number, message: string, status_text?: string): Response {
  return new Response(JSON.stringify({
    error: { code: status, message, status: status_text },
  }), { status, headers: { 'content-type': 'application/json' } });
}

describe('GeminiClient', () => {
  it('coalesces identical in-flight requests', async () => {
    let release: ((value: Response) => void) | undefined;
    const fetcher: typeof fetch = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const client = new GeminiClient('test-key', 'test-model', 1000, fetcher);
    const first = client.generate('create my report task');
    const second = client.generate('create my report task');
    release?.(response(200));

    await expect(first).resolves.toEqual(intent);
    await expect(second).resolves.toEqual(intent);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries rate limits and server errors before succeeding', async () => {
    const fetcher: typeof fetch = vi.fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const client = new GeminiClient('test-key', 'test-model', 1000, fetcher);

    await expect(client.generate('create report')).resolves.toEqual(intent);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed model JSON without retrying', async () => {
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(response(200, 'not json'));
    const client = new GeminiClient('test-key', 'test-model', 1000, fetcher);

    await expect(client.generate('create report')).rejects.toThrow(AIError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('aborts the underlying fetch when the caller cancels', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal;
      requestSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const client = new GeminiClient('test-key', 'test-model', 1000, fetcher);
    const pending = client.generate('create report', controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toThrow(AIError);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('times out by aborting fetch and reports a network error', async () => {
    const fetcher: typeof fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const client = new GeminiClient('test-key', 'test-model', 5, fetcher);

    await expect(client.generate('create report')).rejects.toThrow(NetworkError);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('distinguishes an invalid key from other rejection causes', async () => {
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(
      errorResponse(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT'),
    );
    const client = new GeminiClient('test-key', 'test-model', 1000, fetcher);

    await expect(client.generate('create report')).rejects.toThrow(/rejected this API key/);
  });

  it('reports a retired model instead of blaming the key', async () => {
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(
      errorResponse(404, 'models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent.', 'NOT_FOUND'),
    );
    const client = new GeminiClient('test-key', 'gemini-2.5-flash', 1000, fetcher);

    const error = await client.generate('create report').catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AIError);
    expect((error as AIError).message).toMatch(/retired by Google/);
    expect((error as AIError).message).toContain('GEMINI_MODEL');
  });

  it('names the recommended model when a custom model is missing', async () => {
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(errorResponse(404, 'model not found', 'NOT_FOUND'));
    const client = new GeminiClient('test-key', 'gemini-nope', 1000, fetcher);

    await expect(client.generate('create report')).rejects.toThrow(new RegExp(`gemini-nope.*${RECOMMENDED_MODEL}`));
  });

  it('explains a disabled API or missing permission', async () => {
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(
      errorResponse(403, 'Generative Language API has not been used in project 123456789 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/generativelanguage.googleapis.com/overview?project=123456789 then retry.', 'PERMISSION_DENIED'),
    );
    const client = new GeminiClient('test-key', 'test-model', 1000, fetcher);

    const error = await client.generate('create report').catch((thrown: unknown) => thrown);
    expect((error as AIError).message).toContain('PERMISSION_DENIED');
    expect((error as AIError).message).toMatch(/Enable the Generative Language API/);
  });

  it('distinguishes a leaked key from a disabled API', async () => {
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(
      errorResponse(403, 'Your API key was reported as leaked. Please use another API key.', 'PERMISSION_DENIED'),
    );
    const client = new GeminiClient('test-key', 'test-model', 1000, fetcher);

    await expect(client.generate('create report')).rejects.toThrow(/blocked this key as publicly exposed/);
  });

  it('distinguishes an unsupported region from a disabled API', async () => {
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(
      errorResponse(403, 'User location is not supported for the API call.', 'PERMISSION_DENIED'),
    );
    const client = new GeminiClient('test-key', 'test-model', 1000, fetcher);

    await expect(client.generate('create report')).rejects.toThrow(/not available from this region/);
  });

  it('explains quota once rate-limit retries are exhausted', async () => {
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(errorResponse(429, 'quota exceeded'));
    const client = new GeminiClient('test-key', 'test-model', 1000, fetcher);

    const error = await client.generate('create report').catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toMatch(/rate limit or quota/i);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('never leaks the API key through an echoed error body', async () => {
    const secret = 'AIzaSuperSecretKeyValue123';
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(
      errorResponse(400, `Bad request for https://example.test/?key=${secret}`, 'INVALID_ARGUMENT'),
    );
    const client = new GeminiClient(secret, 'test-model', 1000, fetcher);

    const error = await client.generate('create report').catch((thrown: unknown) => thrown);
    expect((error as AIError).message).not.toContain(secret);
  });

  it('still reports a failure when the body is not JSON', async () => {
    const fetcher: typeof fetch = vi.fn().mockResolvedValue(new Response('gateway down', { status: 418 }));
    const client = new GeminiClient('test-key', 'test-model', 1000, fetcher);

    await expect(client.generate('create report')).rejects.toThrow(AIError);
  });
});
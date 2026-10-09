import { afterEach, describe, expect, it, vi } from 'vitest';
import { OsCredentialStore, parseGeminiKeyCommand, validateGeminiApiKey } from '../src/config/credentialStore.js';
import { UserError } from '../src/core/errors.js';
import { RECOMMENDED_MODEL } from '../src/ai/models.js';

describe('Gemini credential commands', () => {
  it.each([
    ['add AI', 'connect'],
    ['add A1', 'connect'],
    ['ADD Gemini', 'connect'],
    ['connect API key', 'connect'],
    ['replace api key', 'replace'],
    ['replace Gemini API key', 'replace'],
    ['remove api key', 'remove'],
    ['delete Gemini key', 'remove'],
  ] as const)('recognizes %s', (input, action) => {
    expect(parseGeminiKeyCommand(input)).toBe(action);
  });

  it('delegates get, set, and delete to the OS credential entry and preserves store errors', () => {
    const entry = {
      getPassword: vi.fn(() => null),
      setPassword: vi.fn(),
      deletePassword: vi.fn(() => true),
    };
    const store = new OsCredentialStore(entry);
    expect(store.getGeminiApiKey()).toBeUndefined();
    store.setGeminiApiKey('fake-test-key');
    expect(entry.setPassword).toHaveBeenCalledWith('fake-test-key');
    expect(store.deleteGeminiApiKey()).toBe(true);

    const inaccessible = new OsCredentialStore({
      getPassword() { throw new Error('credential store locked'); },
      setPassword() {},
      deletePassword() { return false; },
    });
    expect(() => inaccessible.getGeminiApiKey()).toThrow('could not access the operating-system credential store');
  });

  it('does not classify regular task commands as credential management', () => {
    expect(parseGeminiKeyCommand('add DBMS assignment')).toBeNull();
    expect(parseGeminiKeyCommand('show my tasks')).toBeNull();
  });

  it('validates key bounds and rejects control/whitespace characters', () => {
    expect(validateGeminiApiKey(`  ${'a'.repeat(32)}  `)).toBe('a'.repeat(32));
    expect(() => validateGeminiApiKey('short')).toThrow(UserError);
    expect(() => validateGeminiApiKey(`a${'b'.repeat(30)} c`)).toThrow(UserError);
    expect(() => validateGeminiApiKey('a'.repeat(257))).toThrow(UserError);
  });
});

describe('TaskFlowApplication Gemini key lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('verifies a candidate before saving and switches to the connected client', async () => {
    const store = createMemoryStore();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'recommend_next_task', confidence: 1 }) }] } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const app = createApplication(store);
    try {
      await expect(app.interpretRequest('ADD Gemini')).resolves.toMatchObject({ status: 'credential', action: 'connect' });
      expect(store.value).toBeUndefined();
      await expect(app.saveGeminiApiKey(`AIza${'x'.repeat(32)}`)).resolves.toContain('verified and saved');
      expect(store.value).toBe(`AIza${'x'.repeat(32)}`);
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      app.close();
    }
  });

  it('does not save a key when verification fails and says so', async () => {
    const store = createMemoryStore();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    const app = createApplication(store);
    try {
      const error = await app.saveGeminiApiKey(`AIza${'y'.repeat(32)}`).catch((thrown: unknown) => thrown);
      expect((error as Error).message).toMatch(/Enable the Generative Language API|Generative Language API is enabled/);
      expect((error as Error).message).toContain('The key was not saved.');
      expect(store.value).toBeUndefined();
    } finally {
      app.close();
    }
  });

  it('explains a retired model instead of blaming the key when saving', async () => {
    const store = createMemoryStore();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 404, message: `models/${RECOMMENDED_MODEL} is not found for API version v1beta`, status: 'NOT_FOUND' },
    }), { status: 404 })));
    const app = createApplication(store, { GEMINI_MODEL: 'gemini-2.5-flash' });
    try {
      const error = await app.saveGeminiApiKey(`AIza${'z'.repeat(32)}`).catch((thrown: unknown) => thrown);
      expect((error as Error).message).toMatch(/retired by Google/);
      expect(store.value).toBeUndefined();
    } finally {
      app.close();
    }
  });

  it('requests confirmation before removal and replaces the stored key only after verification', async () => {
    const store = createMemoryStore(`AIza${'a'.repeat(32)}`);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'recommend_next_task', confidence: 1 }) }] } }],
    }), { status: 200 })));
    const app = createApplication(store);
    try {
      await expect(app.interpretRequest('delete api key')).resolves.toMatchObject({ status: 'credential', action: 'remove' });
      expect(store.value).toBe(`AIza${'a'.repeat(32)}`);
      await app.saveGeminiApiKey(`AIza${'b'.repeat(32)}`);
      expect(store.value).toBe(`AIza${'b'.repeat(32)}`);
      expect(app.removeGeminiApiKey()).toContain('removed from the OS credential store');
      expect(store.value).toBeUndefined();
    } finally {
      app.close();
    }
  });

  it('does not overwrite environment-configured credentials', async () => {
    const store = createMemoryStore();
    const app = createApplication(store, { GEMINI_API_KEY: `AIza${'e'.repeat(32)}` });
    try {
      await expect(app.interpretRequest('replace api key')).resolves.toMatchObject({ status: 'done', message: expect.stringContaining('configured in the environment') });
      expect(store.value).toBeUndefined();
    } finally {
      app.close();
    }
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskFlowApplication } from '../src/app/application.js';
import { loadConfig } from '../src/config/config.js';
import type { CredentialStore } from '../src/config/credentialStore.js';

function createMemoryStore(value?: string): CredentialStore & { value: string | undefined } {
  return {
    value,
    getGeminiApiKey() { return this.value; },
    setGeminiApiKey(apiKey) { this.value = apiKey; },
    deleteGeminiApiKey() {
      const hadKey = this.value !== undefined;
      this.value = undefined;
      return hadKey;
    },
  };
}

function createApplication(store: CredentialStore, env: NodeJS.ProcessEnv = {}): TaskFlowApplication {
  const directory = mkdtempSync(join(tmpdir(), 'taskflow-credentials-'));
  const config = loadConfig({ ...env, TASKFLOW_DATABASE_PATH: join(directory, 'tasks.sqlite3'), TASKFLOW_TIMEZONE: 'UTC' });
  const app = TaskFlowApplication.open(config, undefined, store);
  const close = app.close.bind(app);
  app.close = () => {
    close();
    rmSync(directory, { recursive: true, force: true });
  };
  return app;
}
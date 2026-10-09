import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config.js';
import { ConfigurationError } from '../src/core/errors.js';
import { resolveDatabasePath } from '../src/config/config.js';
import { join } from 'node:path';

describe('loadConfig', () => {
  it('loads defaults and resolves the database path', () => {
    const config = loadConfig({});

    expect(config.databasePath).toMatch(/\.taskflow\/taskflow\.sqlite3$/);
    expect(config.timezone.length).toBeGreaterThan(0);
    expect(config.geminiApiKey).toBeUndefined();
  });

  it('rejects an invalid timezone without exposing values', () => {
    expect(() => loadConfig({ TASKFLOW_TIMEZONE: 'not/a-zone', GEMINI_API_KEY: 'secret-value' }))
      .toThrow(ConfigurationError);
    expect(() => loadConfig({ TASKFLOW_TIMEZONE: 'not/a-zone' }))
      .toThrow('TASKFLOW_TIMEZONE must be a valid IANA timezone.');
  });

  it('rejects invalid timeout and confidence ranges', () => {
    expect(() => loadConfig({ TASKFLOW_AI_TIMEOUT_MS: '200' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ TASKFLOW_CONFIDENCE_THRESHOLD: '1.5' })).toThrow(ConfigurationError);
  });

  it('defaults to the auto provider and reads AX 1 settings from the environment', () => {
    const config = loadConfig({});
    expect(config.aiProvider).toBe('auto');
    expect(config.ax1Binary).toBe('ax1');
    // The working directory must stay out of the folder holding the database.
    expect(config.ax1WorkingDirectory).toMatch(/\.taskflow[/\\]ax1$/);
    expect(loadConfig({ TASKFLOW_AI_PROVIDER: 'ax1' }).aiProvider).toBe('ax1');
    expect(loadConfig({ TASKFLOW_AI_PROVIDER: 'none' }).aiProvider).toBe('none');
  });

  it('rejects an unknown provider rather than silently falling back', () => {
    expect(() => loadConfig({ TASKFLOW_AI_PROVIDER: 'openai' })).toThrow(ConfigurationError);
  });

  it('expands home paths and resolves relative paths predictably while preserving spaces', () => {
    expect(resolveDatabasePath('~/Documents/TASKFLOW/taskflow.sqlite3', { cwd: '/workspace', home: '/Users/test user' }))
      .toBe('/Users/test user/Documents/TASKFLOW/taskflow.sqlite3');
    expect(resolveDatabasePath('data folder/tasks.sqlite3', { cwd: '/workspace', home: '/Users/test' }))
      .toBe('/workspace/data folder/tasks.sqlite3');
    expect(resolveDatabasePath('/Volumes/Work Drive/tasks.sqlite3', { cwd: '/workspace', home: '/Users/test' }))
      .toBe('/Volumes/Work Drive/tasks.sqlite3');
    expect(resolveDatabasePath('~', { cwd: '/workspace', home: '/Users/test user' })).toBe('/Users/test user');
    expect(loadConfig({ TASKFLOW_DATABASE_PATH: '~/Documents/TASKFLOW/taskflow.sqlite3' }).databasePath)
      .toBe(join(process.env['HOME'] ?? '/Users', 'Documents', 'TASKFLOW', 'taskflow.sqlite3'));
  });
});
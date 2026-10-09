import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { ConfigurationError } from '../core/errors.js';
import { RECOMMENDED_MODEL } from '../ai/models.js';

const configSchema = z.object({
  databasePath: z.string().min(1),
  timezone: z.string().min(1),
  geminiApiKey: z.string().min(1).optional(),
  geminiModel: z.string().min(1),
  aiTimeoutMs: z.coerce.number().int().min(1000).max(120_000),
  confidenceThreshold: z.coerce.number().min(0).max(1),
  aiProvider: z.enum(['auto', 'gemini', 'ax1', 'none']),
  ax1Binary: z.string().min(1),
  ax1WorkingDirectory: z.string().min(1),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    databasePath: env['TASKFLOW_DATABASE_PATH'] ?? join(homedir(), '.taskflow', 'taskflow.sqlite3'),
    timezone: env['TASKFLOW_TIMEZONE'] ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    geminiApiKey: env['GEMINI_API_KEY'] || undefined,
    geminiModel: env['GEMINI_MODEL'] ?? RECOMMENDED_MODEL,
    aiTimeoutMs: env['TASKFLOW_AI_TIMEOUT_MS'] ?? '20000',
    confidenceThreshold: env['TASKFLOW_CONFIDENCE_THRESHOLD'] ?? '0.8',
    aiProvider: env['TASKFLOW_AI_PROVIDER'] ?? 'auto',
    ax1Binary: env['TASKFLOW_AX1_BINARY'] ?? 'ax1',
    // AX 1 keeps its scratch files under ./workspace, so it runs in its own
    // directory rather than the folder that holds the TaskFlow database.
    ax1WorkingDirectory: env['TASKFLOW_AX1_WORKDIR'] ?? join(homedir(), '.taskflow', 'ax1'),
  });

  if (!parsed.success) {
    throw new ConfigurationError(`Invalid configuration: ${parsed.error.issues.map((issue) => issue.path.join('.') || 'config').join(', ')}`);
  }

  const timezone = parsed.data.timezone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch (cause) {
    throw new ConfigurationError('TASKFLOW_TIMEZONE must be a valid IANA timezone.', { cause });
  }

  return {
    ...parsed.data,
    databasePath: resolveDatabasePath(parsed.data.databasePath),
  };
}

export function resolveDatabasePath(
  configuredPath: string,
  options: { cwd?: string; home?: string } = {},
): string {
  if (!configuredPath.trim()) throw new ConfigurationError('TASKFLOW_DATABASE_PATH cannot be empty.');
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const expanded = configuredPath === '~'
    ? home
    : configuredPath.startsWith('~/')
      ? join(home, configuredPath.slice(2))
      : configuredPath;
  return resolve(cwd, expanded);
}
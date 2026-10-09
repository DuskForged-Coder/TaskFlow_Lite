import { appendFile, chmod, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const logPath = join(homedir(), '.taskflow', 'taskflow.log');

export async function logError(error: unknown, secrets: readonly string[] = []): Promise<void> {
  const message = formatErrorDetails(error);
  await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
  await appendFile(logPath, `${new Date().toISOString()} ${redactSecrets(message, secrets)}\n`, { mode: 0o600 });
  await chmod(logPath, 0o600);
}

export function formatErrorDetails(error: unknown): string {
  const details: string[] = [];
  const seen = new Set<Error>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    details.push(current.stack ?? `${current.name}: ${current.message}`);
    if (current instanceof AggregateError) {
      for (const nested of current.errors) {
        if (nested !== current.cause) details.push(formatErrorDetails(nested));
      }
    }
    current = current.cause;
  }
  if (current !== undefined && !(current instanceof Error)) details.push(String(current));
  return details.join('\nCaused by: ');
}

export function redactSecrets(message: string, secrets: readonly string[] = []): string {
  const redacted = message
    .replace(/(AIza[\w-]{20,})/g, '[REDACTED_API_KEY]')
    .replace(/(mongodb(?:\+srv)?:\/\/[^\s:/]+):([^@\s]+)@/gi, '$1:[REDACTED]@')
    .replace(/(GEMINI_API_KEY\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  return secrets.filter(Boolean).reduce((output, secret) => output.split(secret).join('[REDACTED_SECRET]'), redacted);
}
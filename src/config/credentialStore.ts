import { Entry } from '@napi-rs/keyring';
import { ConfigurationError, UserError } from '../core/errors.js';

const serviceName = 'TaskFlow Gemini';
const accountName = 'default';

export interface CredentialStore {
  getGeminiApiKey(): string | undefined;
  setGeminiApiKey(apiKey: string): void;
  deleteGeminiApiKey(): boolean;
}

export class OsCredentialStore implements CredentialStore {
  constructor(private readonly entry: Pick<Entry, 'getPassword' | 'setPassword' | 'deletePassword'> = new Entry(serviceName, accountName)) {}

  getGeminiApiKey(): string | undefined {
    try {
      return this.entry.getPassword() ?? undefined;
    } catch (cause) {
      throw new ConfigurationError('TaskFlow could not access the operating-system credential store.', { cause });
    }
  }

  setGeminiApiKey(apiKey: string): void {
    try {
      this.entry.setPassword(apiKey);
    } catch (cause) {
      throw new ConfigurationError('TaskFlow could not save the Gemini key to the operating-system credential store.', { cause });
    }
  }

  deleteGeminiApiKey(): boolean {
    try {
      return this.entry.deletePassword();
    } catch (cause) {
      throw new ConfigurationError('TaskFlow could not remove the Gemini key from the operating-system credential store.', { cause });
    }
  }
}

export type GeminiKeyCommand = 'connect' | 'replace' | 'remove';

export function parseGeminiKeyCommand(input: string): GeminiKeyCommand | null {
  const command = input.trim().replace(/[?.!]+$/, '').trim().toLowerCase();
  if (/^(?:add|connect)\s+(?:ai|a1|gemini|(?:the\s+)?api key)(?:\s+api key)?$/.test(command)) return 'connect';
  if (/^(?:replace|change|update)\s+(?:(?:the|my)\s+)?(?:(?:ai|gemini)\s+)?(?:api\s+)?key$/.test(command)) return 'replace';
  if (/^(?:remove|delete|disconnect)\s+(?:(?:the|my)\s+)?(?:(?:ai|gemini)\s+)?(?:api\s+)?key$/.test(command)) return 'remove';
  return null;
}

export function validateGeminiApiKey(input: string): string {
  const key = input.trim();
  if (key.length < 20 || key.length > 256 || /[\u0000-\u0020\u007F-\u009F]/.test(key)) {
    throw new UserError('That does not look like a valid API key. The key was not saved.');
  }
  return key;
}
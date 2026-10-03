import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/utils/logging.js';

describe('redactSecrets', () => {
  it('redacts explicit API keys and credential-bearing database URLs', () => {
    expect(redactSecrets('key=private123 mongodb://alice:password@db.local/task', ['private123']))
      .toBe('key=[REDACTED_SECRET] mongodb://alice:[REDACTED]@db.local/task');
  });
});
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { ensureSqliteNative, isNodeAbiMismatch } = require('../scripts/ensure-sqlite-native.mjs') as {
  ensureSqliteNative: (options?: { loadDatabase?: () => unknown; rebuild?: () => void }) => boolean;
  isNodeAbiMismatch: (error: unknown) => boolean;
};

describe('SQLite native ABI preflight', () => {
  it('recognizes the recorded Node module ABI mismatch', () => {
    const mismatch = new Error('compiled against NODE_MODULE_VERSION 137, runtime requires NODE_MODULE_VERSION 141');
    expect(isNodeAbiMismatch(mismatch)).toBe(true);
    expect(isNodeAbiMismatch(new Error('SQLITE_CANTOPEN: permission denied'))).toBe(false);
  });

  it('rebuilds only after an ABI mismatch, then verifies the driver again', () => {
    const mismatch = new Error('The module was compiled against a different Node.js version using NODE_MODULE_VERSION 137. This version requires NODE_MODULE_VERSION 141.');
    const rebuild = vi.fn();
    const loadDatabase = vi.fn()
      .mockImplementationOnce(() => { throw mismatch; })
      .mockImplementation(() => class FakeDatabase {
        prepare() { return { get: () => ({ result: 1 }) }; }
        close() {}
      });

    expect(ensureSqliteNative({ loadDatabase, rebuild })).toBe(true);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(loadDatabase).toHaveBeenCalledTimes(2);
  });

  it('does not rebuild or hide unrelated native/filesystem failures', () => {
    const failure = new Error('SQLITE_CANTOPEN: permission denied');
    const rebuild = vi.fn();
    expect(() => ensureSqliteNative({ loadDatabase: () => { throw failure; }, rebuild })).toThrow(failure);
    expect(rebuild).not.toHaveBeenCalled();
  });
});
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SingleInstanceGuard, socketPathFor, type GuardDeps } from '../src/app/singleInstance.js';

describe('SingleInstanceGuard', () => {
  const created: string[] = [];
  afterEach(() => {
    for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function makeDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'taskflow-lock-'));
    created.push(directory);
    return directory;
  }

  /** Fake socket server so tests never bind a real port or path. */
  function fakeDeps(overrides: Partial<GuardDeps> = {}): Partial<GuardDeps> {
    const listen = vi.fn();
    const close = vi.fn();
    const server = { on: vi.fn().mockReturnThis(), listen, close, unref: vi.fn() };
    return {
      createServer: vi.fn(() => server) as unknown as GuardDeps['createServer'],
      connect: vi.fn(() => ({ on: vi.fn().mockReturnThis(), write: vi.fn(), end: vi.fn() })) as unknown as GuardDeps['connect'],
      randomToken: () => `token-${Math.random().toString(16).slice(2, 10)}`,
      ...overrides,
    };
  }

  it('acquires the lock when no other instance is running', () => {
    const directory = makeDirectory();
    const guard = new SingleInstanceGuard(directory, undefined, fakeDeps());

    expect(guard.acquire()).toBeUndefined();
    const record = JSON.parse(readFileSync(join(directory, 'taskflow.lock'), 'utf8'));
    expect(record.pid).toBe(process.pid);
    expect(record.token).toEqual(expect.any(String));
  });

  it('refuses a second instance and asks the first to show itself', () => {
    const directory = makeDirectory();
    // A different, live pid already owns the lock.
    writeFileSync(join(directory, 'taskflow.lock'), JSON.stringify({
      pid: process.pid + 1, token: 'other', startedAt: new Date().toISOString(), socketPath: join(directory, 'taskflow.sock'),
    }));
    const connect = vi.fn(() => ({ on: vi.fn().mockReturnThis(), write: vi.fn(), end: vi.fn() }));
    const guard = new SingleInstanceGuard(directory, undefined, fakeDeps({
      isProcessAlive: () => true,
      connect: connect as unknown as GuardDeps['connect'],
    }));

    const result = guard.acquire();
    expect(result?.message).toMatch(/already running/);
    // The second instance signals rather than opening the database.
    expect(connect).toHaveBeenCalledOnce();
  });

  it('reclaims a lock left behind by a process that is gone', () => {
    const directory = makeDirectory();
    writeFileSync(join(directory, 'taskflow.lock'), JSON.stringify({
      pid: process.pid + 1, token: 'stale', startedAt: new Date().toISOString(), socketPath: join(directory, 'taskflow.sock'),
    }));
    const guard = new SingleInstanceGuard(directory, undefined, fakeDeps({ isProcessAlive: () => false }));

    expect(guard.acquire()).toBeUndefined();
    expect(JSON.parse(readFileSync(join(directory, 'taskflow.lock'), 'utf8')).token).not.toBe('stale');
  });

  it('treats a corrupt lock file as absent rather than refusing to start', () => {
    const directory = makeDirectory();
    writeFileSync(join(directory, 'taskflow.lock'), 'not json at all');
    const guard = new SingleInstanceGuard(directory, undefined, fakeDeps());

    expect(guard.acquire()).toBeUndefined();
  });

  it('starts when a lock file exists but carries no usable pid', () => {
    const directory = makeDirectory();
    writeFileSync(join(directory, 'taskflow.lock'), JSON.stringify({ nope: true }));
    const guard = new SingleInstanceGuard(directory, undefined, fakeDeps({ isProcessAlive: () => true }));

    expect(guard.acquire()).toBeUndefined();
  });

  it('releases the lock and is idempotent', () => {
    const directory = makeDirectory();
    const guard = new SingleInstanceGuard(directory, undefined, fakeDeps());
    guard.acquire();
    expect(existsSync(join(directory, 'taskflow.lock'))).toBe(true);

    guard.release();
    expect(existsSync(join(directory, 'taskflow.lock'))).toBe(false);
    expect(() => guard.release()).not.toThrow();
  });

  it('leaves a successor instance lock alone when releasing', () => {
    const directory = makeDirectory();
    const guard = new SingleInstanceGuard(directory, undefined, fakeDeps());
    guard.acquire();
    // Simulate another instance taking over after this one started.
    writeFileSync(join(directory, 'taskflow.lock'), JSON.stringify({
      pid: process.pid + 2, token: 'successor', startedAt: new Date().toISOString(), socketPath: join(directory, 'taskflow.sock'),
    }));

    guard.release();
    expect(JSON.parse(readFileSync(join(directory, 'taskflow.lock'), 'utf8')).token).toBe('successor');
  });

  it('reports a clear message when the running instance cannot be reached', () => {
    const directory = makeDirectory();
    writeFileSync(join(directory, 'taskflow.lock'), JSON.stringify({
      pid: process.pid + 1, token: 'other', startedAt: new Date().toISOString(), socketPath: join(directory, 'taskflow.sock'),
    }));
    const guard = new SingleInstanceGuard(directory, undefined, fakeDeps({
      isProcessAlive: () => true,
      connect: vi.fn(() => { throw new Error('ECONNREFUSED'); }) as unknown as GuardDeps['connect'],
    }));

    expect(guard.acquire()?.message).toMatch(/Only one instance/);
  });

  it('falls back to the temp directory when the socket path would be too long', () => {
    expect(socketPathFor('/short/dir')).toContain('/short/dir');

    const fallback = socketPathFor(`/${'a'.repeat(200)}`);
    // macOS caps Unix socket paths near 104 bytes.
    expect(Buffer.byteLength(fallback)).toBeLessThan(100);
    expect(fallback).toContain(tmpdir());
  });

  it('keeps the fallback socket path unique per data directory', () => {
    const a = socketPathFor(`/${'x'.repeat(120)}/one`);
    const b = socketPathFor(`/${'x'.repeat(120)}/two`);
    expect(a).not.toBe(b);
  });
});
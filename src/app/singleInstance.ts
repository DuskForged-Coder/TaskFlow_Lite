import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface LockRecord {
  pid: number;
  /** Distinguishes this launch from a recycled pid, so a stale lock is detected. */
  token: string;
  startedAt: string;
  /** Unix socket the running instance listens on, for activation messages. */
  socketPath: string;
}

export interface GuardDeps {
  isProcessAlive(pid: number): boolean;
  createServer: typeof createServer;
  connect: typeof connect;
  mkdir: typeof mkdirSync;
  writeFile: typeof writeFileSync;
  readFile: typeof readFileSync;
  unlink: typeof unlinkSync;
  exists: typeof existsSync;
  now(): Date;
  randomToken(): string;
  socketPathFor(directory: string): string;
}

/**
 * Unix socket paths are capped near 104 bytes on macOS, so a long home directory
 * can overflow. In that case the socket moves to the temp directory under a hash
 * of the lock path, which keeps it unique per data directory.
 */
export function socketPathFor(directory: string): string {
  const direct = join(directory, 'taskflow.sock');
  if (Buffer.byteLength(direct) < 100) return direct;
  return join(tmpdir(), `taskflow-${createHash('sha256').update(directory).digest('hex').slice(0, 12)}.sock`);
}

const defaultDeps: GuardDeps = {
  isProcessAlive(pid) {
    // Signal 0 checks existence and permission without delivering a signal.
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM means the process exists but belongs to another user.
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
  createServer,
  connect,
  mkdir: mkdirSync,
  writeFile: writeFileSync,
  readFile: readFileSync,
  unlink: unlinkSync,
  exists: existsSync,
  now: () => new Date(),
  randomToken: () => createHash('sha256').update(`${process.pid}:${process.hrtime.bigint()}`).digest('hex').slice(0, 16),
  socketPathFor,
};

/**
 * Ensures only one TaskFlow process owns the database at a time.
 *
 * The floating interface is a long-lived process, so a user can easily end up
 * with both the orb and a terminal session open. SQLite permits a single writer,
 * so without arbitration the second process would surface random "database is
 * locked" errors. The first instance holds a lock file and listens on a Unix
 * socket; a later instance finds the live lock, asks the running one to reveal
 * itself, and exits instead of opening the database.
 */
export class SingleInstanceGuard {
  private readonly lockPath: string;
  private readonly socketPath: string;
  private readonly record: LockRecord;
  private server: Server | undefined;
  private released = false;
  private readonly deps: GuardDeps;
  private readonly onActivate: (() => void) | undefined;

  constructor(
    private readonly directory: string,
    onActivate?: () => void,
    deps: Partial<GuardDeps> = {},
  ) {
    this.deps = { ...defaultDeps, ...deps };
    this.onActivate = onActivate;
    this.lockPath = join(directory, 'taskflow.lock');
    this.socketPath = this.deps.socketPathFor(directory);
    this.record = {
      pid: process.pid,
      token: this.deps.randomToken(),
      startedAt: this.deps.now().toISOString(),
      socketPath: this.socketPath,
    };
  }

  /**
   * Attempts to become the owning instance. Returns `undefined` on success, or a
   * message describing the live instance when another process holds the lock. A
   * stale lock left by a crashed process is reclaimed automatically.
   */
  acquire(): { message: string } | undefined {
    this.deps.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const existing = this.readLock();
    if (existing && existing.pid !== process.pid && this.deps.isProcessAlive(existing.pid)) {
      return { message: this.announce(existing) };
    }
    this.writeLock();
    this.listen();
    return undefined;
  }

  /** Reads the lock file, treating an unreadable or malformed one as absent. */
  private readLock(): LockRecord | undefined {
    if (!this.deps.exists(this.lockPath)) return undefined;
    try {
      const parsed = JSON.parse(this.deps.readFile(this.lockPath, 'utf8')) as LockRecord;
      if (typeof parsed?.pid !== 'number' || typeof parsed?.token !== 'string') return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private writeLock(): void {
    this.deps.writeFile(this.lockPath, JSON.stringify(this.record, null, 2), { mode: 0o600 });
  }

  /** Asks the running instance to surface its window. */
  private announce(record: LockRecord): string {
    try {
      const socket = this.deps.connect(record.socketPath);
      socket.on('error', () => undefined);
      socket.write('show');
      socket.end();
      return 'TaskFlow is already running. Its window was brought to the front.';
    } catch {
      return 'TaskFlow is already running. Only one instance can hold the database at a time.';
    }
  }

  /**
   * Listens for activation messages so running `taskflow` again reveals the
   * existing window rather than starting a process that would contend for the
   * database.
   */
  private listen(): void {
    try {
      this.deps.unlink(this.socketPath);
    } catch {
      // No leftover socket to remove.
    }
    const server = this.deps.createServer((socket: Socket) => {
      socket.on('error', () => undefined);
      socket.on('data', () => this.onActivate?.());
    });
    // A socket failure must never stop TaskFlow from opening its database.
    server.on('error', () => undefined);
    server.listen(this.socketPath);
    // unref keeps the guard from holding the event loop open on its own.
    server.unref();
    this.server = server;
  }

  /** Releases the lock and socket. Safe to call more than once. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.server?.close();
    // Only remove the lock if this process still owns it.
    if (this.readLock()?.token === this.record.token) {
      try {
        this.deps.unlink(this.lockPath);
      } catch {
        // Nothing to clean up.
      }
    }
    try {
      this.deps.unlink(this.socketPath);
    } catch {
      // Nothing to clean up.
    }
  }
}
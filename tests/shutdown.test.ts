import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ShutdownCoordinator, type SignalSource } from '../src/app/shutdown.js';

describe('ShutdownCoordinator', () => {
  it('closes resources once and is idempotent across repeated calls', async () => {
    const close = vi.fn();
    const stopAccepting = vi.fn();
    const restore = vi.fn();
    const coordinator = new ShutdownCoordinator({ close, stopAccepting }, restore);
    const first = coordinator.shutdown();
    const second = coordinator.shutdown();

    expect(first).toBe(second);
    await first;
    expect(close).toHaveBeenCalledTimes(1);
    expect(stopAccepting).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(coordinator.isAcceptingWork).toBe(false);
    expect(coordinator.controller.signal.aborted).toBe(true);
  });

  it.each(['SIGINT', 'SIGTERM'] as const)('handles %s through the installed signal listener', async (signal) => {
    const emitter = new EventEmitter();
    const signals = emitter as unknown as SignalSource;
    const close = vi.fn();
    const restore = vi.fn();
    const coordinator = new ShutdownCoordinator({ close }, restore, signals);
    coordinator.install();

    emitter.emit(signal);
    await coordinator.shutdown();

    expect(close).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount('SIGINT')).toBe(0);
    expect(emitter.listenerCount('SIGTERM')).toBe(0);
  });
});
import type { TaskFlowApplication } from './application.js';

type Signal = 'SIGINT' | 'SIGTERM';

export interface SignalSource {
  on(signal: Signal, listener: () => void): unknown;
  off(signal: Signal, listener: () => void): unknown;
}

export class ShutdownCoordinator {
  private shuttingDown: Promise<void> | undefined;
  private accepting = true;
  readonly controller = new AbortController();
  private readonly handleSignal = () => {
    void this.shutdown().catch(() => {
      process.exitCode = 1;
    });
  };

  constructor(
    private readonly application: Pick<TaskFlowApplication, 'close'> & Partial<Pick<TaskFlowApplication, 'stopAccepting'>>,
    private readonly restoreTerminal: () => void,
    private readonly signals: SignalSource = process,
  ) {}

  get isAcceptingWork(): boolean {
    return this.accepting;
  }

  install(): void {
    this.signals.on('SIGINT', this.handleSignal);
    this.signals.on('SIGTERM', this.handleSignal);
  }

  shutdown(): Promise<void> {
    if (this.shuttingDown) return this.shuttingDown;
    this.accepting = false;
    this.application.stopAccepting?.();
    this.controller.abort();
    this.signals.off('SIGINT', this.handleSignal);
    this.signals.off('SIGTERM', this.handleSignal);
    this.shuttingDown = (async () => {
      try {
        this.application.close();
      } finally {
        this.restoreTerminal();
        process.exitCode = 0;
      }
    })();
    return this.shuttingDown;
  }
}
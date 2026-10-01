import { createSingleFlight } from './singleFlight';

/** Fixed-interval background work with one active run and cancellable startup. */
export class PeriodicTask {
  private active = false;
  private generation = 0;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private finishStartup: (() => void) | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly flight = createSingleFlight<void>();

  constructor(private readonly options: {
    intervalMs: number;
    startupDelayMs?: number;
    run: () => Promise<void>;
    onError: (error: unknown) => void;
  }) {}

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    const generation = ++this.generation;

    if (this.options.startupDelayMs) {
      await new Promise<void>((resolve) => {
        this.finishStartup = resolve;
        this.startupTimer = setTimeout(() => {
          this.startupTimer = null;
          this.finishStartup = null;
          resolve();
        }, this.options.startupDelayMs);
      });
    }
    if (!this.active || generation !== this.generation) return;
    await this.run();
    // stop() may have happened while the first request was pending.
    if (!this.active || generation !== this.generation) return;
    this.interval = setInterval(() => { void this.run(); }, this.options.intervalMs);
  }

  stop(): void {
    this.active = false;
    this.generation += 1;
    if (this.interval) clearInterval(this.interval);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.interval = null;
    this.startupTimer = null;
    this.finishStartup?.();
    this.finishStartup = null;
  }

  private async run(): Promise<void> {
    if (!this.active || this.flight.isRunning()) return;
    await this.flight.run(async () => {
      try {
        await this.options.run();
      } catch (error) {
        this.options.onError(error);
      }
    });
  }
}

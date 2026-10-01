import { PeriodicTask } from '../src/utils/periodicTask';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('PeriodicTask', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the initial delay and fixed interval, and ignores duplicate starts', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const task = new PeriodicTask({ intervalMs: 100, startupDelayMs: 50, run, onError: vi.fn() });
    const start = task.start();
    await task.start();
    await vi.advanceTimersByTimeAsync(49);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await start;
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledTimes(3);
    task.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels startup and can restart without reviving an old timer', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const task = new PeriodicTask({ intervalMs: 100, startupDelayMs: 50, run, onError: vi.fn() });
    const abandonedStart = task.start();
    task.stop();
    const restarted = task.start();
    await abandonedStart;
    await vi.advanceTimersByTimeAsync(50);
    await restarted;
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    task.stop();
  });

  it('does not install an interval after being stopped during the initial request', async () => {
    const pending = deferred();
    const run = vi.fn(() => pending.promise);
    const task = new PeriodicTask({ intervalMs: 100, run, onError: vi.fn() });
    const start = task.start();
    task.stop();
    pending.resolve();
    await start;
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips overlapping ticks and resumes after a slow request', async () => {
    const pending = deferred();
    const run = vi.fn().mockResolvedValue(undefined);
    const task = new PeriodicTask({ intervalMs: 100, run, onError: vi.fn() });
    await task.start();
    run.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(2);
    pending.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(3);
    task.stop();
  });

  it('retries on the next interval after an initial failure', async () => {
    const failure = new Error('temporary outage');
    const run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const onError = vi.fn();
    const task = new PeriodicTask({ intervalMs: 100, run, onError });
    await task.start();
    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    task.stop();
  });
});

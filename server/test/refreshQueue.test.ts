import { createRefreshQueue } from '../../client/src/utils/refreshQueue';

describe('client refresh queue', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
  afterEach(() => vi.useRealTimers());

  it('merges event keys and expedites an urgent event without dropping normal keys', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const queue = createRefreshQueue(refresh);
    queue.setActive(true);
    queue.enqueue([['stats']], 'immediate');
    await vi.advanceTimersByTimeAsync(0);
    queue.enqueue([['blocks']]);
    queue.enqueue([['blocks'], ['mempool']], 'high');
    await vi.advanceTimersByTimeAsync(249);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenLastCalledWith([['blocks'], ['mempool']]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps requests arriving during a fetch and runs them after it finishes', async () => {
    let finish!: () => void;
    const refresh = vi.fn().mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const queue = createRefreshQueue(refresh);
    queue.setActive(true);
    queue.enqueue([['blocks']], 'immediate');
    await vi.advanceTimersByTimeAsync(0);
    queue.enqueue([['blocks'], ['mempool']], 'high');
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith([['blocks'], ['mempool']]);
  });

  it('clears hidden/unmounted work, including pending work during a running fetch', async () => {
    let finish!: () => void;
    const refresh = vi.fn().mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const queue = createRefreshQueue(refresh);
    queue.setActive(true);
    queue.enqueue([['blocks']], 'immediate');
    await vi.advanceTimersByTimeAsync(0);
    queue.enqueue([['mempool']]);
    queue.setActive(false);
    finish();
    await vi.advanceTimersByTimeAsync(10000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    queue.setActive(true);
    queue.enqueue([['stats']], 'immediate');
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenLastCalledWith([['stats']]);
  });

  it('continues after a refresh failure', async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const queue = createRefreshQueue(refresh);
    queue.setActive(true);
    queue.enqueue([['blocks']], 'immediate');
    await vi.advanceTimersByTimeAsync(0);
    queue.enqueue([['blocks']], 'immediate');
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

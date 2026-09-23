import { describe, expect, it, vi } from 'vitest';
import { createSingleFlight } from '../src/utils/singleFlight';

describe('createSingleFlight', () => {
  it('coalesces concurrent work into one factory call', async () => {
    let resolve!: (value: string) => void;
    const deferred = new Promise<string>((done) => {
      resolve = done;
    });
    const factory = vi.fn(() => deferred);
    const singleFlight = createSingleFlight<string>();

    const first = singleFlight.run(factory);
    const second = singleFlight.run(factory);
    const third = singleFlight.run(factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(singleFlight.isRunning()).toBe(true);

    resolve('snapshot');
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      'snapshot',
      'snapshot',
      'snapshot',
    ]);
    expect(singleFlight.isRunning()).toBe(false);
  });

  it('allows a retry after the in-flight operation fails', async () => {
    const factory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('recovered');
    const singleFlight = createSingleFlight<string>();

    await expect(singleFlight.run(factory)).rejects.toThrow('temporary failure');
    await expect(singleFlight.run(factory)).resolves.toBe('recovered');
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

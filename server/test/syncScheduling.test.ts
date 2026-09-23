import { runScheduledSyncAttempt } from '../src/services/sync/syncScheduling';

describe('sync scheduler', () => {
  it('skips overlapping runs without invoking the sync operation', async () => {
    const run = vi.fn(async () => undefined);
    const onSkipped = vi.fn();

    await expect(
      runScheduledSyncAttempt({ isBusy: () => true, run, onSkipped })
    ).resolves.toBe('skipped');
    expect(run).not.toHaveBeenCalled();
    expect(onSkipped).toHaveBeenCalledOnce();
  });

  it('reports successful runs', async () => {
    const run = vi.fn(async () => undefined);

    await expect(runScheduledSyncAttempt({ isBusy: () => false, run })).resolves.toBe(
      'completed'
    );
    expect(run).toHaveBeenCalledOnce();
  });

  it('does not latch failures and allows the next interval to retry', async () => {
    const error = new Error('temporary RPC failure');
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const options = { isBusy: () => false, run, onError };

    await expect(runScheduledSyncAttempt(options)).resolves.toBe('failed');
    expect(onError).toHaveBeenCalledWith(error);
    await expect(runScheduledSyncAttempt(options)).resolves.toBe('completed');
    expect(run).toHaveBeenCalledTimes(2);
  });
});

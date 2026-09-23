export interface ScheduledSyncOptions {
  isBusy: () => boolean;
  run: () => Promise<void>;
  onSkipped?: () => void;
  onError?: (error: unknown) => void;
}

/** One interval is one attempt; a failed attempt is retried by the next interval. */
export async function runScheduledSyncAttempt(
  options: ScheduledSyncOptions
): Promise<'skipped' | 'completed' | 'failed'> {
  if (options.isBusy()) {
    options.onSkipped?.();
    return 'skipped';
  }
  try {
    await options.run();
    return 'completed';
  } catch (error) {
    options.onError?.(error);
    return 'failed';
  }
}

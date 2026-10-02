export type RefreshKeys = ReadonlyArray<ReadonlyArray<unknown>>;
export type RefreshPriority = 'normal' | 'high' | 'immediate';
const DELAY_MS = { normal: 1200, high: 250, immediate: 0 };

/** Coalesce pending keys, but retain events arriving during an active fetch. */
export function createRefreshQueue(refresh: (keys: RefreshKeys) => Promise<unknown>) {
  const pending = new Map<string, ReadonlyArray<unknown>>();
  let active = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFinishedAt = 0;
  let minGap = Infinity;

  function schedule() {
    if (!active || running || pending.size === 0) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, Math.max(0, lastFinishedAt + minGap - Date.now()));
  }

  async function flush() {
    timer = null;
    if (!active || running || pending.size === 0) return;
    const keys = [...pending.values()];
    pending.clear();
    minGap = Infinity;
    running = true;
    try {
      await refresh(keys);
    } catch {
      // Query errors are exposed by the query client; later events can retry.
    } finally {
      lastFinishedAt = Date.now();
      running = false;
      schedule();
    }
  }

  return {
    enqueue(keys: RefreshKeys, priority: RefreshPriority = 'normal') {
      if (!active) return;
      for (const key of keys) pending.set(JSON.stringify(key), key);
      minGap = Math.min(minGap, DELAY_MS[priority]);
      schedule();
    },
    setActive(value: boolean) {
      active = value;
      if (!value) {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        pending.clear();
        minGap = Infinity;
      }
    },
  };
}

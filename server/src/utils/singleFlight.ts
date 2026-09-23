export type SingleFlight<T> = {
  run(factory: () => Promise<T>): Promise<T>;
  isRunning(): boolean;
};

export function createSingleFlight<T>(): SingleFlight<T> {
  let inFlight: Promise<T> | null = null;

  return {
    async run(factory: () => Promise<T>): Promise<T> {
      if (inFlight) return inFlight;

      const current = factory();
      inFlight = current;
      try {
        return await current;
      } finally {
        if (inFlight === current) inFlight = null;
      }
    },
    isRunning(): boolean {
      return inFlight !== null;
    },
  };
}

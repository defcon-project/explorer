import { config } from '../config';
import { prewarmDashboardOverviewCache } from '../routes/dashboard.routes';
import { getEnrichedPayload } from './masternode.service';
import { getStatsData } from './stats.service';
import { logger } from '../utils/logger';

const STARTUP_DELAY_MS = 10_000;
const INTERVAL_MS = Math.max(15_000, Math.min(25_000, Math.max(1, config.cache.ttlSeconds) * 1000));

class CachePrewarmService {
  private isRunning = false;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.startupTimer = setTimeout(() => {
      this.prewarm('startup-delay').catch((err) => {
        logger.warn('Cache prewarm startup run failed:', err);
      });
    }, STARTUP_DELAY_MS);

    this.intervalId = setInterval(() => {
      this.prewarm('interval').catch((err) => {
        logger.warn('Cache prewarm interval run failed:', err);
      });
    }, INTERVAL_MS);

    logger.info(`Cache prewarm service started (${INTERVAL_MS / 1000}s interval)`);
  }

  stop(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Cache prewarm service stopped');
  }

  async prewarm(reason = 'manual'): Promise<void> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      const startedAt = Date.now();
      const tasks = await Promise.allSettled([
        prewarmDashboardOverviewCache(),
        getStatsData(),
        getEnrichedPayload(),
      ]);

      const rejected = tasks.filter((task) => task.status === 'rejected');
      if (rejected.length > 0) {
        logger.warn(`Cache prewarm completed with ${rejected.length} failure(s) (${reason}).`);
        for (const task of rejected) {
          if (task.status === 'rejected') logger.debug('Cache prewarm task failed:', task.reason);
        }
      } else {
        logger.debug(`Cache prewarm completed in ${Date.now() - startedAt}ms (${reason}).`);
      }
    })().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }
}

export const cachePrewarmService = new CachePrewarmService();

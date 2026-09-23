import { MasternodeEvent } from '../models/MasternodeEvent';
import { fetchRawMasternodes as fetchMasternodeStatusSnapshot, getEnrichedNodes } from './masternode.service';
import { config } from '../config';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = config.masternode.pollIntervalMs;

type StatusSnapshotNode = { id: string; status?: string; service: string };
type EnrichedSnapshotNode = Awaited<ReturnType<typeof getEnrichedNodes>>[number];

function eventIdentity(node: Pick<EnrichedSnapshotNode, 'id' | 'proTxHash'>): string {
  return node.proTxHash || node.id;
}

class MasternodePollerService {
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot = new Map<string, string>(); // nodeId -> status
  private hasBaseline = false;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initial baseline poll (silent for status-change events, but historical ban
    // events are still upserted append-only from PoSeBanHeight).
    try {
      await this.poll();
    } catch (err) {
      logger.warn('Masternode poller: initial baseline failed, will retry on next interval:', err);
    }

    this.intervalId = setInterval(() => {
      this.poll().catch((err) => logger.error('Masternode poller error:', err));
    }, POLL_INTERVAL_MS);

    logger.info(`Masternode poller started (${POLL_INTERVAL_MS / 1000}s interval)`);
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Masternode poller stopped');
  }

  private async recordHistoricalBanEvents(): Promise<void> {
    let nodes: EnrichedSnapshotNode[];
    try {
      nodes = await getEnrichedNodes();
    } catch (err) {
      logger.debug('Masternode poller: could not fetch enriched nodes for ban history', err);
      return;
    }

    if (nodes.length === 0) return;

    const now = new Date();
    const liveById = new Map(nodes.map((node) => [node.id, node]));
    const liveByIdentity = new Map<string, EnrichedSnapshotNode>();
    for (const node of nodes) {
      liveByIdentity.set(eventIdentity(node), node);
    }

    const banOps = nodes
      .filter((node) => node.status === 'POSE_BANNED' && typeof node.poseBanHeight === 'number' && node.poseBanHeight > 0)
      .map((node) => {
        const identity = eventIdentity(node);
        const poseBanHeight = node.poseBanHeight as number;
        const eventKey = `ban:${identity}:${poseBanHeight}`;
        const detectedAt =
          typeof node.poseBanAt === 'number' && Number.isFinite(node.poseBanAt)
            ? new Date(node.poseBanAt * 1000)
            : now;

        return {
          updateOne: {
            filter: { eventKey },
            update: {
              $setOnInsert: {
                eventKey,
                eventType: 'ban',
                previousStatus: 'POSE_BAN_HEIGHT',
                detectedAt,
                poseBanHeight,
                detectedHeight: poseBanHeight,
              },
              $set: {
                eventStatus: 'banned',
                nodeId: node.id,
                proTxHash: node.proTxHash ?? null,
                service: node.service || '',
                ip: node.ip || null,
                port: typeof node.port === 'number' ? node.port : null,
                provider: node.provider || null,
                providerSource: node.providerSource || null,
                providerTagCidr: node.providerTagCidr || null,
                providerTagSource: node.providerTagSource || null,
                providerConfidence: typeof node.providerConfidence === 'number' ? node.providerConfidence : null,
                countryCode: node.countryCode || null,
                countryName: node.countryName || null,
                operatorPubkey: node.operatorPubkey || null,
                payoutAddress: node.payoutAddress || null,
                currentStatus: 'POSE_BANNED',
                updatedAt: now,
              },
            },
            upsert: true,
          },
        };
      });

    if (banOps.length > 0) {
      await MasternodeEvent.bulkWrite(banOps as any, { ordered: false });
    }

    const openBanEvents = await MasternodeEvent.find(
      { eventType: 'ban', eventStatus: 'banned' },
      { _id: 1, nodeId: 1, proTxHash: 1, currentStatus: 1, recoveredAt: 1 },
    ).lean();

    const recoveryOps = [];
    for (const event of openBanEvents as Array<{
      _id: unknown;
      nodeId: string;
      proTxHash?: string | null;
    }>) {
      const live =
        (event.proTxHash ? liveByIdentity.get(event.proTxHash) : undefined) ||
        liveById.get(event.nodeId) ||
        liveByIdentity.get(event.nodeId);

      if (!live || live.status === 'POSE_BANNED') continue;

      const recoveredHeight =
        typeof live.poseRevivedHeight === 'number' && live.poseRevivedHeight > 0
          ? live.poseRevivedHeight
          : null;

      recoveryOps.push({
        updateOne: {
          filter: { _id: event._id, eventStatus: 'banned' },
          update: {
            $set: {
              eventStatus: 'recovered',
              recoveredAt: now,
              recoveredHeight,
              recoveryTransition: `POSE_BANNED -> ${live.status || 'VALID'}`,
              currentStatus: live.status || 'ENABLED',
              service: live.service || '',
              ip: live.ip || null,
              port: typeof live.port === 'number' ? live.port : null,
              provider: live.provider || null,
              providerSource: live.providerSource || null,
              providerTagCidr: live.providerTagCidr || null,
              providerTagSource: live.providerTagSource || null,
              providerConfidence: typeof live.providerConfidence === 'number' ? live.providerConfidence : null,
              countryCode: live.countryCode || null,
              countryName: live.countryName || null,
              operatorPubkey: live.operatorPubkey || null,
              payoutAddress: live.payoutAddress || null,
              updatedAt: now,
            },
          },
        },
      });
    }

    if (recoveryOps.length > 0) {
      await MasternodeEvent.bulkWrite(recoveryOps as any, { ordered: false });
      logger.info(`Masternode poller: ${recoveryOps.length} historical ban recovery update(s) recorded`);
    }
  }

  private async poll(): Promise<void> {
    let nodes: StatusSnapshotNode[];
    try {
      nodes = await fetchMasternodeStatusSnapshot();
    } catch {
      logger.debug('Masternode poller: could not fetch nodes, skipping cycle');
      return;
    }

    if (nodes.length === 0) return;

    await this.recordHistoricalBanEvents();

    const currentSnapshot = new Map<string, { status: string; service: string }>();
    for (const node of nodes) {
      const nodeId = String(node.id || '').trim();
      if (!nodeId) continue;
      currentSnapshot.set(nodeId, {
        status: String(node.status || 'UNKNOWN'),
        service: String(node.service || ''),
      });
    }

    if (!this.hasBaseline) {
      // First poll: establish baseline, don't write status transition events.
      this.lastSnapshot = new Map(
        Array.from(currentSnapshot.entries()).map(([id, data]) => [id, data.status])
      );
      this.hasBaseline = true;
      logger.info(`Masternode poller: baseline established with ${nodes.length} nodes`);
      return;
    }

    // Detect status changes
    const events: Array<{
      nodeId: string;
      service: string;
      previousStatus: string;
      currentStatus: string;
    }> = [];

    for (const [nodeId, data] of currentSnapshot) {
      const prevStatus = this.lastSnapshot.get(nodeId);
      if (prevStatus === undefined) {
        // New node appeared
        events.push({
          nodeId,
          service: data.service,
          previousStatus: 'NEW',
          currentStatus: data.status,
        });
      } else if (prevStatus !== data.status) {
        events.push({
          nodeId,
          service: data.service,
          previousStatus: prevStatus,
          currentStatus: data.status,
        });
      }
    }

    // Detect removed nodes
    for (const [nodeId, prevStatus] of this.lastSnapshot) {
      if (!currentSnapshot.has(nodeId)) {
        events.push({
          nodeId,
          service: '',
          previousStatus: prevStatus,
          currentStatus: 'REMOVED',
        });
      }
    }

    if (events.length > 0) {
      const now = new Date();
      await MasternodeEvent.insertMany(
        events.map((e) => ({ ...e, detectedAt: now, eventType: 'status', eventStatus: 'observed', updatedAt: now }))
      );
      logger.info(`Masternode poller: ${events.length} status change(s) recorded`);
    }

    // Update snapshot
    this.lastSnapshot = new Map(
      Array.from(currentSnapshot.entries()).map(([id, data]) => [id, data.status])
    );
  }
}

export const masternodePollerService = new MasternodePollerService();

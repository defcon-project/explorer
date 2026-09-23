import type { IncomingMessage, Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { config } from '../config';
import { logger } from '../utils/logger';
import { SyncState } from '../models/SyncState';
import { rpcService } from './rpc.service';
import { isTrustedProxyPeer, parseForwardedIp } from '../utils/requestIp';
import { mapPublicSyncError } from '../utils/publicSyncError';
import {
  REALTIME_PROTOCOL_VERSION,
  type RealtimeClientEvent,
  type RealtimeServerEventType,
  type RealtimeEnvelope,
  type WsBlockNewPayload,
  type WsErrorPayload,
  type WsHelloPayload,
  type WsPongPayload,
  type WsSyncStatusPayload,
  type WsTxNewPayload,
} from '../types/realtime';

const WS_PATH = '/ws';
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_PAYLOAD_BYTES = 8 * 1024;
// Cap concurrent WS sockets per source IP. Prevents a single client (or a
// hijacked browser fingerprint) from exhausting the connection table and
// indirectly DoS-ing all other realtime subscribers. The HTTP rate limiter
// does NOT cover the WS upgrade path — this is the only enforcement.
const MAX_CONNECTIONS_PER_IP = 8;

type TrackedSocket = WebSocket & {
  connectionId?: string;
  isAlive?: boolean;
  remoteIp?: string;
  slotReleased?: boolean;
};

export type RealtimeConnectionStats = {
  enabled: boolean;
  connectedClients: number;
  ipBuckets: number;
  maxConnectionsPerIp: number;
  heartbeatIntervalMs: number;
};

export class RealtimeService {
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly clients = new Set<TrackedSocket>();
  private readonly perIpCount = new Map<string, number>();
  private sequence = 1;

  init(server: HttpServer): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_PAYLOAD_BYTES,
    });

    server.on('upgrade', (request, socket, head) => {
      if (!this.isRealtimePath(request.url)) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      if (!this.isOriginAllowed(request)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      const remoteIp = this.resolveRemoteIp(request);
      const current = this.perIpCount.get(remoteIp) ?? 0;
      if (current >= MAX_CONNECTIONS_PER_IP) {
        // 429-style refusal at the upgrade boundary. We deliberately do NOT
        // log the IP at warn level on every refusal to avoid log flooding;
        // the counter itself is the audit trail.
        socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss?.handleUpgrade(request, socket, head, (socketClient) => {
        const tracked = socketClient as TrackedSocket;
        tracked.remoteIp = remoteIp;
        this.perIpCount.set(remoteIp, current + 1);
        this.handleConnection(tracked);
      });
    });

    this.wss.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });

    this.startHeartbeat();
    logger.info(`Realtime WebSocket endpoint enabled at ${WS_PATH}`);
  }

  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const client of this.clients) {
      this.releaseClient(client);
      try {
        client.terminate();
      } catch {
        // ignore
      }
    }

    if (!this.wss) return;

    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
    });
    this.wss = null;
  }

  publishSyncStatus(payload: WsSyncStatusPayload): void {
    this.broadcast('sync:status', payload);
  }

  publishNewBlock(payload: WsBlockNewPayload): void {
    this.broadcast('block:new', payload);
  }

  publishNewTx(payload: WsTxNewPayload): void {
    this.broadcast('tx:new', payload);
  }

  getConnectionStats(): RealtimeConnectionStats {
    return {
      enabled: this.wss !== null,
      connectedClients: this.clients.size,
      ipBuckets: this.perIpCount.size,
      maxConnectionsPerIp: MAX_CONNECTIONS_PER_IP,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    };
  }

  private handleConnection(client: TrackedSocket): void {
    client.connectionId = randomUUID();
    client.isAlive = true;
    client.slotReleased = false;
    this.clients.add(client);

    client.on('pong', () => {
      client.isAlive = true;
    });

    client.on('message', (raw) => {
      this.handleClientMessage(client, raw);
    });

    client.on('close', () => {
      this.releaseClient(client);
    });

    client.on('error', () => {
      this.releaseClient(client);
    });

    const hello: WsHelloPayload = {
      connectionId: client.connectionId,
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    };

    this.sendToClient(client, 'hello', hello);
    void this.sendInitialSyncStatus(client);
  }

  private handleClientMessage(client: TrackedSocket, raw: RawData): void {
    const message = this.parseClientMessage(raw);
    if (!message) {
      const errorPayload: WsErrorPayload = {
        code: 'INVALID_MESSAGE',
        message: 'Expected JSON object with type="ping".',
      };
      this.sendToClient(client, 'error', errorPayload);
      return;
    }

    if (message.type === 'ping') {
      const pong: WsPongPayload = { clientTs: message.data?.clientTs };
      this.sendToClient(client, 'pong', pong);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        if (client.isAlive === false) {
          this.releaseClient(client);
          try {
            client.terminate();
          } catch {
            // ignore
          }
          continue;
        }

        client.isAlive = false;
        try {
          client.ping();
        } catch {
          this.releaseClient(client);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  private broadcast<TData>(type: RealtimeServerEventType, data: TData): void {
    if (this.clients.size === 0) return;
    const message = JSON.stringify(this.envelope(type, data));

    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        this.releaseClient(client);
        continue;
      }

      try {
        client.send(message);
      } catch {
        this.releaseClient(client);
      }
    }
  }

  private sendToClient<TData>(client: TrackedSocket, type: RealtimeServerEventType, data: TData): void {
    if (client.readyState !== WebSocket.OPEN) {
      this.releaseClient(client);
      return;
    }

    try {
      client.send(JSON.stringify(this.envelope(type, data)));
    } catch {
      this.releaseClient(client);
    }
  }

  /**
   * Removes a socket and releases its per-IP reservation exactly once. A ws
   * socket commonly emits `error` before `close`, so all terminal paths must
   * converge here instead of decrementing the counter independently.
   */
  private releaseClient(client: TrackedSocket): void {
    this.clients.delete(client);
    if (client.slotReleased) return;
    client.slotReleased = true;

    const ip = client.remoteIp;
    if (!ip) return;
    const next = (this.perIpCount.get(ip) ?? 1) - 1;
    if (next <= 0) this.perIpCount.delete(ip);
    else this.perIpCount.set(ip, next);
  }

  private envelope<TData>(
    type: RealtimeServerEventType,
    data: TData
  ): RealtimeEnvelope<RealtimeServerEventType, TData> {
    return {
      type,
      ts: new Date().toISOString(),
      seq: this.nextSequence(),
      data,
    };
  }

  private nextSequence(): number {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) {
      this.sequence = 1;
      return this.sequence;
    }
    const current = this.sequence;
    this.sequence += 1;
    return current;
  }

  private isRealtimePath(rawUrl?: string): boolean {
    if (!rawUrl) return false;
    try {
      const parsed = new URL(rawUrl, 'http://localhost');
      return parsed.pathname === WS_PATH;
    } catch {
      return false;
    }
  }

  private isOriginAllowed(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (!origin) return true;

    const configuredOrigins = config.cors.origins;
    if (configuredOrigins.length > 0) {
      return configuredOrigins.includes(origin);
    }

    if (config.nodeEnv !== 'production') {
      return true;
    }

    try {
      const originHost = new URL(origin).host;
      return typeof request.headers.host === 'string' && request.headers.host === originHost;
    } catch {
      return false;
    }
  }

  // Resolve the client IP for the per-IP connection cap. Mirrors the HTTP
  // resolveRequestIp policy: prefer trusted proxy headers, validate, fall
  // back to the socket peer, return 'unknown' if nothing parses so a
  // malformed XFF cannot fragment the bucket.
  private resolveRemoteIp(request: IncomingMessage): string {
    const peer = request.socket.remoteAddress ?? '';
    const cleanedPeer = peer.startsWith('::ffff:') ? peer.slice(7) : peer;

    if (isTrustedProxyPeer(cleanedPeer)) {
      for (const headerName of config.rateLimit.ipHeaders) {
        const raw = request.headers[headerName];
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (typeof value !== 'string') continue;
        const parsed = parseForwardedIp(value);
        if (parsed) return parsed;
      }
    }

    return parseForwardedIp(cleanedPeer) || 'unknown';
  }

  private parseClientMessage(raw: RawData): RealtimeClientEvent | null {
    let text = '';

    if (typeof raw === 'string') {
      text = raw;
    } else if (raw instanceof Buffer) {
      text = raw.toString('utf8');
    } else if (Array.isArray(raw)) {
      text = Buffer.concat(raw).toString('utf8');
    } else if (raw instanceof ArrayBuffer) {
      text = Buffer.from(new Uint8Array(raw)).toString('utf8');
    } else {
      text = '';
    }

    try {
      const parsed = JSON.parse(text) as Partial<RealtimeClientEvent>;
      if (parsed?.type !== 'ping') return null;
      return {
        type: 'ping',
        ts: typeof parsed.ts === 'string' ? parsed.ts : new Date().toISOString(),
        data:
          parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
            ? { clientTs: typeof parsed.data.clientTs === 'string' ? parsed.data.clientTs : undefined }
            : {},
      };
    } catch {
      return null;
    }
  }

  private async sendInitialSyncStatus(client: TrackedSocket): Promise<void> {
    try {
      const [syncState, daemonHeightRaw] = await Promise.all([
        SyncState.findOne({ key: 'main' }).lean(),
        rpcService.getBlockCount().catch(() => -1),
      ]);

      const daemonHeight = Number.isFinite(daemonHeightRaw) ? daemonHeightRaw : -1;
      const lastSyncedHeight = syncState?.lastSyncedHeight ?? -1;
      const blocksRemaining = daemonHeight >= 0 ? Math.max(0, daemonHeight - lastSyncedHeight) : 0;
      const progress = this.progressPercent(lastSyncedHeight, daemonHeight);

      let state: WsSyncStatusPayload['state'] = 'idle';
      if (syncState?.error) {
        state = 'error';
      } else if (syncState?.isRunning) {
        state = 'syncing';
      } else if (daemonHeight >= 0 && blocksRemaining === 0) {
        state = 'complete';
      }

      const payload: WsSyncStatusPayload = {
        state,
        daemonHeight,
        lastSyncedHeight,
        blocksRemaining,
        progress,
        error: mapPublicSyncError(syncState?.error, daemonHeight >= 0).error,
      };
      this.sendToClient(client, 'sync:status', payload);
    } catch (error) {
      logger.debug('Failed to send initial sync status over websocket:', error);
    }
  }

  private progressPercent(lastSyncedHeight: number, daemonHeight: number): number {
    if (daemonHeight < 0) return 0;
    if (daemonHeight === 0) return lastSyncedHeight >= 0 ? 100 : 0;
    const raw = ((lastSyncedHeight + 1) / (daemonHeight + 1)) * 100;
    return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
  }
}

export const realtimeService = new RealtimeService();

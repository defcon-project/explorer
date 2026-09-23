import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  getSummary: vi.fn(),
}));

vi.mock('../src/services/networkNoise.service', () => ({
  networkNoiseService: mocks,
}));

import networkNoiseRoutes from '../src/routes/v1/networkNoise.v1.routes';

const TOKEN = 'a'.repeat(64);

function summaryPayload() {
  return {
    generatedAt: '2026-07-12T09:22:07.000Z',
    windowHours: 24,
    staleAfterSeconds: 300,
    summary: {
      currentScore: 72,
      currentLevel: 'severe' as const,
      knownNodes: 1,
      reportingNodes: 1,
      staleNodes: 0,
      activeSignals: 4,
      chainAlerts: 1,
    },
    nodes: [
      {
        nodeId: 'node-a',
        nodeRole: 'fullnode' as const,
        walletVersion: 'v23.0.0',
        agentVersion: '1.0.0',
        lastReportedAt: '2026-07-12T09:22:07.000Z',
        blockHeight: 99_331,
        bestBlockHash: 'a'.repeat(64),
        chainLockHeight: 99_331,
        chainLockHash: 'a'.repeat(64),
        connections: 8,
        inbound: 5,
        outbound: 3,
        syncing: false,
        noiseScore: 72,
        signalCount: 4,
        activeSignalTypes: ['chainlock_conflict'],
        lastCleanAt: null,
        isStale: false,
      },
    ],
    timeline: [{ bucket: '2026-07-12T09:00:00.000Z', signalType: 'chainlock_conflict', count: 4, nodes: ['node-a'] }],
    recentSignals: [
      {
        nodeId: 'node-a',
        nodeRole: 'fullnode',
        walletVersion: 'v23.0.0',
        signalType: 'chainlock_conflict',
        fingerprint: 'ef0a97b51d4622a99a8d39b1',
        count: 4,
        firstSeenAt: '2026-07-12T09:20:00.000Z',
        lastSeenAt: '2026-07-12T09:21:00.000Z',
        sample: 'AcceptBlockHeader: block <hash> is marked conflicting',
        blockHeight: 99_331,
        bestBlockHash: 'a'.repeat(64),
        chainLockHeight: 99_331,
        chainLockHash: 'a'.repeat(64),
      },
    ],
  };
}

function validPayload() {
  return {
    schemaVersion: 1,
    agentVersion: '1.0.0',
    nodeId: 'node-a',
    nodeRole: 'fullnode',
    observedAt: '2026-07-12T09:22:07Z',
    sequence: 12,
    snapshot: {
      ip: '198.51.100.40',
      walletVersion: 'v23.0.0',
      blockHeight: 99331,
      bestBlockHash: 'a'.repeat(64),
      chainLockHeight: 99331,
      chainLockHash: 'a'.repeat(64),
      connections: 8,
      inbound: 5,
      outbound: 3,
      syncing: false,
    },
    signals: [
      {
        type: 'chainlock_conflict',
        fingerprint: 'ef0a97b51d4622a99a8d39b1',
        count: 4,
        firstSeenAt: '2026-07-12T09:20:00Z',
        lastSeenAt: '2026-07-12T09:21:00Z',
        peerIps: ['203.0.113.10'],
        sample: 'AcceptBlockHeader: block <hash> is marked conflicting',
      },
    ],
  };
}

describe('network noise v1 routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/network-noise', networkNoiseRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
    config.networkNoise.enabled = true;
    config.networkNoise.ingestTokens = { 'node-a': TOKEN };
    mocks.ingest.mockResolvedValue({ duplicate: false, acceptedSignals: 1, noiseScore: 72 });
    mocks.getSummary.mockResolvedValue(summaryPayload());
  });

  it('accepts one authenticated telemetry batch', async () => {
    const response = await request(app)
      .post('/api/v1/network-noise/ingest')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(validPayload());

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(mocks.ingest).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid node token', async () => {
    const response = await request(app)
      .post('/api/v1/network-noise/ingest')
      .set('Authorization', 'Bearer invalid-token')
      .send(validPayload());

    expect(response.status).toBe(401);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('rejects malformed telemetry without calling the service', async () => {
    const response = await request(app)
      .post('/api/v1/network-noise/ingest')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ ...validPayload(), sequence: -1 });

    expect(response.status).toBe(400);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('returns the stored summary', async () => {
    const response = await request(app).get('/api/v1/network-noise/summary?hours=24');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mocks.getSummary).toHaveBeenCalledWith(24);
  });
});

import express from 'express';
import request from 'supertest';
import {
  banWaveAnalysisApiResponseSchema,
  masternodeEventsApiResponseSchema,
} from '@defcon/shared/dist/contracts';
import masternodesV1Routes from '../src/routes/v1/masternodes.v1.routes';
import { getEnrichedNodes } from '../src/services/masternode.service';
import { MasternodeEvent } from '../src/models/MasternodeEvent';
import { NodeInventory } from '../src/models/NodeInventory';

vi.mock('../src/services/masternode.service', () => ({
  getEnrichedNodes: vi.fn(),
}));

function mockEventFind(rows: Array<Record<string, unknown>>) {
  const query = {
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(rows),
  };
  vi.spyOn(MasternodeEvent, 'find').mockReturnValue(query as never);
}

function mockInventoryFind(rows: Array<Record<string, unknown>> = []) {
  const query = {
    lean: vi.fn().mockResolvedValue(rows),
  };
  vi.spyOn(NodeInventory, 'find').mockReturnValue(query as never);
}

describe('masternodes v1 ban wave history', () => {
  const app = express();
  app.use('/api/v1/masternodes', masternodesV1Routes);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps historical waves after nodes recover and reports current state separately', async () => {
    const detectedAt = new Date(Date.now() - 60 * 60 * 1000);
    const recoveredAt = new Date(Date.now() - 10 * 60 * 1000);

    vi.mocked(getEnrichedNodes).mockResolvedValue([
      {
        id: 'node-a',
        status: 'ENABLED',
        service: '10.0.0.1:8192',
        proTxHash: 'protx-a',
        ip: '10.0.0.1',
        port: 8192,
        countryCode: 'DE',
        countryName: 'Germany',
        provider: 'Contabo',
        operatorPubkey: 'op-a',
        payoutAddress: 'Dabc',
      },
      {
        id: 'node-b',
        status: 'POSE_BANNED',
        service: '10.0.0.2:8192',
        proTxHash: 'protx-b',
        ip: '10.0.0.2',
        port: 8192,
        countryCode: 'US',
        countryName: 'United States',
        provider: 'RackNerd',
        operatorPubkey: 'op-b',
        payoutAddress: 'Ddef',
      },
      {
        id: 'node-c',
        status: 'POSE_BANNED',
        service: '10.0.0.3:8192',
        proTxHash: 'protx-c',
        ip: '10.0.0.3',
        port: 8192,
        countryCode: 'US',
        countryName: 'United States',
        provider: 'RackNerd',
        operatorPubkey: 'op-c',
        payoutAddress: 'Dghi',
      },
    ] as never);

    mockEventFind([
      {
        nodeId: 'node-a',
        proTxHash: 'protx-a',
        service: '10.0.0.1:8192',
        previousStatus: 'POSE_BAN_HEIGHT',
        detectedAt,
        eventStatus: 'recovered',
        ip: '10.0.0.1',
        countryCode: 'DE',
        countryName: 'Germany',
        provider: 'Contabo',
        operatorPubkey: 'op-a',
        payoutAddress: 'Dabc',
        poseBanHeight: 100,
        detectedHeight: 100,
        recoveredAt,
        recoveredHeight: 105,
        recoveryTransition: 'POSE_BANNED -> ENABLED',
      },
      {
        nodeId: 'node-b',
        proTxHash: 'protx-b',
        service: '10.0.0.2:8192',
        previousStatus: 'POSE_BAN_HEIGHT',
        detectedAt,
        eventStatus: 'banned',
        ip: '10.0.0.2',
        countryCode: 'US',
        countryName: 'United States',
        provider: 'RackNerd',
        operatorPubkey: 'op-b',
        payoutAddress: 'Ddef',
        poseBanHeight: 100,
        detectedHeight: 100,
      },
      {
        nodeId: 'node-c',
        proTxHash: 'protx-c',
        service: '10.0.0.3:8192',
        previousStatus: 'POSE_BAN_HEIGHT',
        detectedAt,
        eventStatus: 'banned',
        ip: '10.0.0.3',
        countryCode: 'US',
        countryName: 'United States',
        provider: 'RackNerd',
        operatorPubkey: 'op-c',
        payoutAddress: 'Dghi',
        poseBanHeight: 100,
        detectedHeight: 100,
      },
    ]);
    mockInventoryFind([
      { ip: '10.0.0.1', walletVersion: '22.1.2', protocolVersion: 70238, lastObservedAt: new Date() },
      { ip: '10.0.0.2', walletVersion: '22.1.3', protocolVersion: 70238, lastObservedAt: new Date() },
    ]);

    const res = await request(app)
      .get('/api/v1/masternodes/ban-waves')
      .query({ hours: 24, windowMinutes: 30, minNodes: 3 });

    expect(res.status).toBe(200);
    expect(banWaveAnalysisApiResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.success).toBe(true);
    expect(res.body.data.currentPoseBanned).toBe(2);
    expect(res.body.data.currentValid).toBe(1);
    expect(res.body.data.freshDrops24h).toBe(3);
    expect(res.body.data.eventBreakdown.recoveredEvents).toBe(1);
    expect(res.body.data.eventBreakdown.stillBannedEvents).toBe(2);
    expect(res.body.data.timelineModes).toHaveProperty('recovered');
    expect(res.body.data.timelineModes).toHaveProperty('still');

    const wave = res.body.data.waves[0];
    expect(wave.totalNodes).toBe(3);
    expect(wave.recoveredCount).toBe(1);
    expect(wave.stillBannedCount).toBe(2);
    expect(wave.providers).toEqual(['Contabo', 'RackNerd']);
    expect(wave.versions).toEqual(['22.1.2', '22.1.3']);
    expect(wave.nodes.map((node: { status: string }) => node.status).sort()).toEqual([
      'recovered',
      'still_banned',
      'still_banned',
    ]);
  });

  it('normalizes stored event timestamps before returning the shared event contract', async () => {
    const detectedAt = new Date(Date.now() - 60_000);
    const query = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          _id: { toString: () => 'event-1' },
          nodeId: 'node-a',
          service: '10.0.0.1:8192',
          previousStatus: 'ENABLED',
          currentStatus: 'POSE_BANNED',
          detectedAt,
          countryCode: null,
          countryName: null,
        },
      ]),
    };
    vi.spyOn(MasternodeEvent, 'find').mockReturnValue(query as never);

    const res = await request(app).get('/api/v1/masternodes/events').query({ hours: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(masternodeEventsApiResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.data.events[0]).toMatchObject({
      _id: 'event-1',
      detectedAt: detectedAt.toISOString(),
    });
  });
});

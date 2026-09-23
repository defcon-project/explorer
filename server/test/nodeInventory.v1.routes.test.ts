import express from 'express';
import request from 'supertest';
import { networkVersionSampleApiResponseSchema } from '@defcon/shared/dist/contracts';
import nodeInventoryRoutes from '../src/routes/v1/nodeInventory.v1.routes';
import { NodeInventory } from '../src/models/NodeInventory';

describe('node inventory version sample', () => {
  const app = express();
  app.use('/api/v1/node-inventory', nodeInventoryRoutes);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deduplicates hosts and summarizes recent identified versions', async () => {
    const now = new Date();
    const rows = [
      {
        ip: '198.51.100.1',
        port: 8192,
        walletVersion: '23.0.0',
        protocolVersion: 70242,
        blockHeight: 110_000,
        sources: ['direct_peer'],
        lastSeenAt: now,
        lastObservedAt: now,
        lastVersionObservedAt: now,
      },
      {
        ip: '198.51.100.1',
        port: 9999,
        walletVersion: '22.1.4',
        protocolVersion: 70239,
        blockHeight: 109_900,
        sources: ['dns_seeder'],
        lastSeenAt: new Date(now.getTime() - 60_000),
        lastObservedAt: new Date(now.getTime() - 60_000),
        lastVersionObservedAt: new Date(now.getTime() - 60_000),
      },
      {
        ip: '198.51.100.2',
        port: 8192,
        walletVersion: '22.1.4',
        protocolVersion: 70239,
        blockHeight: 109_990,
        sources: ['seed_node'],
        lastSeenAt: now,
        lastObservedAt: now,
        lastVersionObservedAt: now,
      },
      {
        ip: '198.51.100.3',
        port: 8192,
        walletVersion: null,
        protocolVersion: null,
        blockHeight: null,
        sources: ['masternode_rpc'],
        lastSeenAt: now,
        lastObservedAt: now,
      },
    ];

    const lean = jest.fn().mockResolvedValue(rows);
    const sort = jest.fn().mockReturnValue({ lean });
    jest.spyOn(NodeInventory, 'find').mockReturnValue({ sort } as never);

    const response = await request(app).get('/api/v1/node-inventory/versions?hours=24');

    expect(response.status).toBe(200);
    expect(networkVersionSampleApiResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.data.summary).toMatchObject({
      observed: 3,
      identified: 2,
      unidentified: 1,
      coveragePct: 66.67,
    });
    expect(response.body.data.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: '23.0.0', count: 1, sharePct: 50, observedSharePct: 33.33 }),
        expect.objectContaining({ version: '22.1.4', count: 1, sharePct: 50, observedSharePct: 33.33 }),
      ]),
    );
    expect(response.body.data.nodes).toHaveLength(2);
    expect(response.body.data.nodes.filter((node: { ip: string }) => node.ip === '198.51.100.1')).toHaveLength(1);
    expect(response.body.data.nodes.find((node: { ip: string }) => node.ip === '198.51.100.2')).toMatchObject({
      lastVersionObservedAt: now.toISOString(),
    });
  });
});

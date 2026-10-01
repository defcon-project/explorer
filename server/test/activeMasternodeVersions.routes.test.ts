import { getActiveMasternodeVersions } from '../src/services/masternodeVersions.service';
import express from 'express';
import request from 'supertest';
import { activeMasternodeVersionsApiResponseSchema } from '@defcon/shared/dist/contracts';
import nodeInventoryRoutes from '../src/routes/v1/nodeInventory.v1.routes';
import { NodeInventory } from '../src/models/NodeInventory';
import { getEnrichedPayload } from '../src/services/masternode.service';

vi.mock('../src/services/masternode.service', () => ({
  getEnrichedPayload: vi.fn(),
  getEnrichedNodes: vi.fn(),
}));

const app = express();
app.use('/api/v1/node-inventory', nodeInventoryRoutes);
const now = new Date('2026-09-28T10:00:00Z');

function node(id: string, status = 'ENABLED', ip: string | null = `198.51.100.${id}`, port = 8192) {
  return { id, proTxHash: `protx-${id}`, status, ip, port };
}

function snapshot(nodes: ReturnType<typeof node>[]) {
  vi.mocked(getEnrichedPayload).mockResolvedValue({
    observedAt: new Date(now.getTime() - 10_000).toISOString(), nodes,
  } as never);
}

function inventory(rows: Array<Record<string, unknown>>) {
  vi.spyOn(NodeInventory, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue(rows) } as never);
}

function version(id: string, walletVersion: string | null, ageHours = 0, extra = {}) {
  return {
    ip: `198.51.100.${id}`, port: 8192, walletVersion,
    lastVersionObservedAt: new Date(now.getTime() - ageHours * 3600_000),
    lastObservedAt: now, masternodeStatus: 'ENABLED', sources: ['Direct peer'], ...extra,
  };
}

describe('active masternode versions', () => {
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now.getTime()); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('shares concurrent snapshots without caching subsequent requests', async () => {
    snapshot([node('1')]);
    inventory([version('1', '23.0.0')]);
    const results = await Promise.all(Array.from({ length: 20 }, () => getActiveMasternodeVersions()));
    expect(NodeInventory.find).toHaveBeenCalledTimes(1);
    expect(getEnrichedPayload).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result === results[0])).toBe(true);
    await getActiveMasternodeVersions();
    expect(NodeInventory.find).toHaveBeenCalledTimes(2);
  });

  it('counts ENABLED plus POSE_PENALTY, excludes inactive and historical nodes, and keeps unknown versions in the denominator', async () => {
    snapshot([node('1'), node('2', 'POSE_PENALTY'), node('3'), node('4'),
      node('5', 'POSE_BANNED'), node('6', 'OFFLINE'), node('7', 'REMOVED')]);
    inventory([version('1', '23.0.0'), version('2', '22.1.4'), version('3', '23.0.0', 25),
      version('5', '23.0.0'), version('6', '23.0.0'), version('8', '23.0.0')]);
    const response = await request(app).get('/api/v1/node-inventory/active-versions');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(activeMasternodeVersionsApiResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.data.summary).toEqual({ total: 4, enabled: 3, posePenalty: 1,
      fresh: 2, stale: 1, unknown: 1, coveragePct: 50, recommended: 2, deprecated: 1 });
    expect(response.body.data.versions).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: '23.0.0', count: 2, sharePct: 50 }),
      expect.objectContaining({ version: '22.1.4', count: 1, sharePct: 25 }),
    ]));
    expect(response.body.data.nodes.map((n: { id: string }) => n.id)).toEqual(['protx-1', 'protx-2', 'protx-3', 'protx-4']);
    expect(response.body.data.statusObservedAt).toBe('2026-09-28T09:59:50.000Z');
  });

  it('counts identities, matches exact endpoints, and rejects a previous registration on a reused endpoint', async () => {
    snapshot([node('1'), node('1'), node('2', 'POSE_PENALTY', '198.51.100.1', 9999), node('3'), node('4', 'ENABLED', null)]);
    inventory([version('1', '23.0.0'), version('2', '22.1.4', 0, { ip: '198.51.100.1', port: 9999 }),
      version('3', '23.0.0', 0, { masternodeProTxHash: 'old-registration' })]);
    const { body } = await request(app).get('/api/v1/node-inventory/active-versions');
    expect(body.data.summary).toMatchObject({ total: 4, fresh: 2, unknown: 2 });
    expect(body.data.nodes.find((n: { id: string }) => n.id === 'protx-2').walletVersion).toBe('22.1.4');
    expect(body.data.nodes.find((n: { id: string }) => n.id === 'protx-3').walletVersion).toBeNull();
  });

  it('does not treat fresh inventory timestamps as fresh version evidence', async () => {
    snapshot([node('1'), node('2'), node('3'), node('4')]);
    inventory([version('1', '23.0.0', 24), version('2', '23.0.0', 24.001),
      version('3', '23.0.0', 0, { lastVersionObservedAt: null }), version('4', '23.0.0', -1)]);
    const { body } = await request(app).get('/api/v1/node-inventory/active-versions');
    expect(body.data.summary).toMatchObject({ total: 4, fresh: 1, stale: 3, coveragePct: 25 });
    expect(body.data.versions).toEqual([{ version: '23.0.0', count: 4, sharePct: 100, isDeprecated: false }]);
    expect(body.data.summary.recommended).toBe(4);
    expect(body.data.nodes.find((n: { id: string }) => n.id === 'protx-3').lastVersionObservedAt).toBeNull();
  });

  it('reports zero active nodes when a valid snapshot contains only inactive statuses', async () => {
    snapshot([node('1', 'POSE_BANNED')]);
    const { body, status } = await request(app).get('/api/v1/node-inventory/active-versions');
    expect(status).toBe(200);
    expect(body.data.summary).toMatchObject({ total: 0, fresh: 0, stale: 0, unknown: 0, coveragePct: 0 });
    expect(body.data.versions).toEqual([]);
  });

  it('fails closed on RPC failure instead of serving historical membership', async () => {
    vi.mocked(getEnrichedPayload).mockRejectedValue(new Error('RPC unavailable'));
    const response = await request(app).get('/api/v1/node-inventory/active-versions');
    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
  });

  it('does not present an ambiguous empty RPC result as zero active masternodes', async () => {
    snapshot([]);
    const response = await request(app).get('/api/v1/node-inventory/active-versions');
    expect(response.status).toBe(503);
  });

  it('does not present a failed inventory read as unknown versions', async () => {
    snapshot([node('1')]);
    vi.spyOn(NodeInventory, 'find').mockReturnValue({ lean: vi.fn().mockRejectedValue(new Error('DB unavailable')) } as never);
    const response = await request(app).get('/api/v1/node-inventory/active-versions');
    expect(response.status).toBe(503);
  });
});

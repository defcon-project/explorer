import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { poseChainApiResponseSchema } from '@defcon/shared/dist/contracts';

const mocks = vi.hoisted(() => ({ getPoseChainData: vi.fn() }));
vi.mock('../src/services/poseChainQuery.service', () => mocks);
vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
import poseChainRoutes from '../src/routes/v1/poseChain.v1.routes';

const app = express();
app.use('/api/v1/masternodes', poseChainRoutes);
describe('PoSe canonical commitment route', () => {
  beforeEach(() => {
    mocks.getPoseChainData.mockResolvedValue({
      generatedAt: new Date().toISOString(), status: 'disabled',
      coverage: { startHeight: 144888, lastHeight: 144887, lastHash: null, targetHeight: null,
        checkedAt: null, lastReorgAt: null, remainingBlocks: null, caughtUp: false, confirmedThroughHeight: 144887 },
      windowHours: 24, page: 1, limit: 10, total: 0, quorumSummary: [], commitments: [],
      penaltyCoverage: { enabled: false, commitmentBlocks: 0, verifiedBlocks: 0, pendingBlocks: 0,
        unavailableBlocks: 0, unsupportedBlocks: 0, inconsistentBlocks: 0, notApplicableBlocks: 0 },
    });
  });

  it('returns schema-checked no-store coverage and normalizes filters', async () => {
    const response = await request(app).get('/api/v1/masternodes/pose-chain')
      .query({ hours: 48, page: 2, limit: 1, quorumType: 7, proTxHash: 'A'.repeat(64) });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(poseChainApiResponseSchema.safeParse(response.body).success).toBe(true);
    expect(mocks.getPoseChainData).toHaveBeenCalledWith({ hours: 48, page: 2, limit: 1, quorumType: 7, proTxHash: 'a'.repeat(64) });
  });

  it('rejects invalid pagination, ranges and hashes before querying the store', async () => {
    for (const query of ['hours=0', 'hours=8761', 'page=0', 'limit=51', 'quorumType=256', 'proTxHash=bad']) {
      expect((await request(app).get(`/api/v1/masternodes/pose-chain?${query}`)).status).toBe(400);
    }
    expect(mocks.getPoseChainData).not.toHaveBeenCalled();
  });

  it('does not publish malformed service output or internal failure details', async () => {
    mocks.getPoseChainData.mockResolvedValueOnce({ status: 'ready' });
    expect((await request(app).get('/api/v1/masternodes/pose-chain')).status).toBe(500);
    mocks.getPoseChainData.mockRejectedValueOnce(new Error('private-rpc-password'));
    const response = await request(app).get('/api/v1/masternodes/pose-chain');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('private-rpc-password');
  });
});

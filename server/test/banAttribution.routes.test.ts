import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { banAttributionApiResponseSchema } from '@defcon/shared/dist/contracts';

const mocks = vi.hoisted(() => ({ getBanAttribution: vi.fn() }));
vi.mock('../src/services/banAttribution.service', () => mocks);
vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
import v1Routes from '../src/routes/v1';
const app = express(); app.use('/api/v1', v1Routes);
const path = '/api/v1/masternodes/ban-attribution';
describe('public BANNED_BY route', () => {
  beforeEach(() => {
    mocks.getBanAttribution.mockResolvedValue({ code: 'BANNED_BY', generatedAt: new Date().toISOString(),
      proTxHash: 'a'.repeat(64), banHeight: 100, collectorStatus: 'disabled', attributionEnabled: false,
      coverage: { startHeight: 144888, lastHeight: 144887, lastHash: null, targetHeight: null,
        checkedAt: null, lastReorgAt: null, remainingBlocks: null, caughtUp: false, confirmedThroughHeight: 144887 },
      status: 'unknown', reason: 'collector_disabled', proof: null, evidence: 'unknown', message: 'unknown', hint: 'check coverage' });
  });
  it('is mounted before dynamic node routes and returns schema-checked, no-store unknown', async () => {
    const response = await request(app).get(path).query({ proTxHash: 'A'.repeat(64), banHeight: '100', blockHash: 'B'.repeat(64) });
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toContain('no-store');
    expect(banAttributionApiResponseSchema.safeParse(response.body).success).toBe(true);
    expect(mocks.getBanAttribution).toHaveBeenCalledWith({ proTxHash: 'a'.repeat(64), banHeight: 100, blockHash: 'b'.repeat(64) });
  });
  it('rejects missing, unsafe, repeated or unexpected filters before reading the database', async () => {
    const valid = { proTxHash: 'a'.repeat(64), banHeight: 100 };
    for (const query of [{}, { proTxHash: valid.proTxHash }, { ...valid, proTxHash: 'bad' }, { ...valid, banHeight: '' },
      { ...valid, banHeight: -1 }, { ...valid, banHeight: 1.5 }, { ...valid, banHeight: 2147483648 },
      { ...valid, blockHash: 'bad' }, { ...valid, hours: 24 }, { ...valid, proTxHash: [valid.proTxHash, valid.proTxHash] }]) {
      expect((await request(app).get(path).query(query)).status).toBe(400);
    }
    expect(mocks.getBanAttribution).not.toHaveBeenCalled();
  });
  it('rejects malformed output and does not leak internal failures', async () => {
    const query = { proTxHash: 'a'.repeat(64), banHeight: 100 };
    mocks.getBanAttribution.mockResolvedValueOnce({ status: 'verified', proof: null });
    expect((await request(app).get(path).query(query)).status).toBe(500);
    mocks.getBanAttribution.mockRejectedValueOnce(new Error('private RPC credentials'));
    const response = await request(app).get(path).query(query);
    expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain('private RPC');
  });
});

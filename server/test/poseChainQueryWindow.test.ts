import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { poseChainQuerySchema } from '@defcon/shared/dist/contracts';
import { config } from '../src/config';

const mocks = vi.hoisted(() => ({ findOne: vi.fn(), aggregate: vi.fn() }));
vi.mock('../src/models/PoseChainState', () => ({ PoseChainState: { findOne: mocks.findOne } }));
vi.mock('../src/models/PoseChainBlock', () => ({ PoseChainBlock: { aggregate: mocks.aggregate } }));
import { getPoseChainData } from '../src/services/poseChainQuery.service';

describe('canonical summary and coverage window', () => {
  const original = { ...config.poseChain };
  const now = new Date('2026-10-07T12:00:00Z');
  const state = { status: 'ready', startHeight: 100, lastHeight: 200, targetHeight: 190,
    checkedAt: now, revision: 1, lastHash: 'a'.repeat(64) };
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    Object.assign(config.poseChain, { enabled: true, attributionEnabled: true });
    mocks.findOne.mockReturnValue({ lean: async () => state });
    mocks.aggregate.mockReturnValueOnce({ option: async () => [{ totals: [], summary: [], rows: [] }] })
      .mockReturnValueOnce({ option: async () => [{ _id: 'verified', count: 2 }] });
  });
  afterEach(() => { vi.useRealTimers(); Object.assign(config.poseChain, original); vi.resetAllMocks(); });
  it('intersects both aggregations with the selected time, activation height and confirmed prefix', async () => {
    const data = await getPoseChainData(poseChainQuerySchema.parse({ hours: 24, since: '2026-10-07T11:00:00Z', fromHeight: 150 }));
    const match = { canonical: true, height: { $gte: 150, $lte: 190 },
      time: { $gte: new Date('2026-10-07T11:00:00Z'), $lte: now } };
    expect(mocks.aggregate.mock.calls[0][0][0]).toEqual({ $match: match });
    expect(mocks.aggregate.mock.calls[1][0][0]).toEqual({ $match: { ...match, 'commitments.0': { $exists: true } } });
    expect(data.penaltyCoverage.verifiedBlocks).toBe(2);
    expect(data.coverage.caughtUp).toBe(true);
  });
  it('cannot extend before the collector start or requested rolling hours', async () => {
    const data = await getPoseChainData(poseChainQuerySchema.parse({ hours: 1, since: '2026-10-01T00:00:00Z', fromHeight: 0 }));
    expect(data.windowFrom).toBe('2026-10-07T11:00:00.000Z');
    expect(mocks.aggregate.mock.calls[0][0][0].$match.height.$gte).toBe(100);
  });
  it('discards the summary and its coverage when a rollback begins during the read', async () => {
    mocks.findOne.mockReturnValueOnce({ lean: async () => state })
      .mockReturnValueOnce({ lean: async () => ({ ...state, revision: 2 }) });
    const data = await getPoseChainData(poseChainQuerySchema.parse({}));
    expect(data).toMatchObject({ status: 'collecting', quorumSummary: [], penaltyCoverage: { verifiedBlocks: 0, commitmentBlocks: 0 } });
  });
});

import { describe, expect, it } from 'vitest';
import { parsePenaltySnapshot, penaltyContextGap, replayPenaltyAttribution,
  type PenaltyState } from '../src/domain/pose/penaltyAttribution';
import { chainHash } from './fixtures/poseChain';

const node = (id: number, fields: Partial<PenaltyState> = {}): PenaltyState => ({
  proTxHash: chainHash(id), penalty: 0, banHeight: -1, revivedHeight: -1, dslBanHeight: -1, ...fields,
});
const commitment = (id = 1, members = [{ proTxHash: chainHash(1), valid: false }]) => ({
  txid: chainHash(id + 100), status: 'verified', members,
});
describe('restricted v23 historical PoSe replay', () => {
  it('projects hash-addressed full-list state without private RPC fields', () => {
    const value = { baseHeight: 0, blockHeight: 99, addedMNs: [{ proTxHash: chainHash(1),
      service: 'private-service', wallet: { key: 'private-wallet' },
      state: { PoSePenalty: 35, PoSeBanHeight: -1, PoSeRevivedHeight: -1, dslBanHeight: -1,
        pubKeyOperator: 'private-key', service: 'private-service' } }], removedMNs: [], updatedMNs: [] };
    expect(parsePenaltySnapshot(value, 99)).toEqual([node(1, { penalty: 35 })]);
  });

  it('rejects incomplete, duplicate, future or non-genesis snapshots', () => {
    const entry = { proTxHash: chainHash(1), state: { PoSePenalty: 0, PoSeBanHeight: -1, PoSeRevivedHeight: -1, dslBanHeight: -1 } };
    const value = { baseHeight: 0, blockHeight: 99, addedMNs: [entry], removedMNs: [], updatedMNs: [] };
    for (const change of [{ baseHeight: 1 }, { blockHeight: 100 }, { addedMNs: [entry, entry] },
      { removedMNs: [chainHash(2)] }, { updatedMNs: [{}] },
      { addedMNs: [{ ...entry, state: { ...entry.state, PoSePenalty: -1 } }] },
      { addedMNs: [{ ...entry, state: { ...entry.state, dslBanHeight: undefined } }] },
      { addedMNs: [{ ...entry, state: { ...entry.state, PoSeBanHeight: 100 } }] }]) {
      expect(() => parsePenaltySnapshot({ ...value, ...change }, 99)).toThrow();
    }
  });

  it('decreases once before punishment, uses the minimum 100 cap and links the exact ban', () => {
    const data = replayPenaltyAttribution(100, [5, 6], [commitment()],
      [node(1, { penalty: 35 })], [node(1, { penalty: 100, banHeight: 100 })]);
    expect(data).toMatchObject({ status: 'verified', registeredCount: 1, maxPenalty: 100,
      applications: [{ previousBlockPenalty: 35, beforePenalty: 34, afterPenalty: 100,
        penaltyAmount: 66, appliedDelta: 66, previousBanHeight: -1, banHeight: 100, causedBan: true }] });
  });

  it('uses the complete registered count, including banned nodes, and floors 66 percent', () => {
    const before = Array.from({ length: 221 }, (_, i) => node(i + 1, { banHeight: i > 0 ? 10 : -1 }));
    const after = before.map((item, i) => i === 0 ? { ...item, penalty: 145 } : item);
    const data = replayPenaltyAttribution(100, [5, 6], [commitment()], before, after);
    expect(data).toMatchObject({ status: 'verified', registeredCount: 221, maxPenalty: 221,
      applications: [{ penaltyAmount: 145, afterPenalty: 145, causedBan: false }] });
  });

  it('keeps transaction order and attaches a new ban only to the commitment crossing the cap', () => {
    const data = replayPenaltyAttribution(100, [5, 6, 6], [commitment(1), commitment(2)],
      [node(1)], [node(1, { penalty: 100, banHeight: 100 })]);
    expect(data.status).toBe('verified');
    expect(data.applications.map((item) => [item.txid, item.beforePenalty, item.afterPenalty, item.causedBan]))
      .toEqual([[chainHash(101), 0, 66, false], [chainHash(102), 66, 100, true]]);
    expect(data.applications[1].appliedDelta).toBe(34);
  });

  it('does not decay already banned nodes or assign a second ban, including the DSL domain', () => {
    const members = [{ proTxHash: chainHash(1), valid: false }, { proTxHash: chainHash(2), valid: false }];
    const before = [node(1, { penalty: 100, banHeight: 10 }), node(2, { penalty: 90, dslBanHeight: 10 })];
    const after = [before[0], { ...before[1], penalty: 100 }];
    const data = replayPenaltyAttribution(100, [5, 6], [commitment(1, members)], before, after);
    expect(data.status).toBe('verified');
    expect(data.applications.map((item) => [item.beforePenalty, item.appliedDelta, item.causedBan, item.banHeight]))
      .toEqual([[100, 0, false, 10], [90, 10, false, -1]]);
  });

  it('skips a former quorum member absent from the unchanged registry', () => {
    const data = replayPenaltyAttribution(100, [5, 6], [commitment()], [node(2)], [node(2)]);
    expect(data).toMatchObject({ status: 'verified', applications: [] });
  });

  it('preserves a signed delta when a dynamic maximum clamps an older higher score', () => {
    const data = replayPenaltyAttribution(100, [5, 6], [commitment()],
      [node(1, { penalty: 200, banHeight: 10 })], [node(1, { penalty: 100, banHeight: 10 })]);
    expect(data).toMatchObject({ status: 'verified', applications: [{ appliedDelta: -100, causedBan: false }] });
  });

  it('keeps mixed provider/service/unknown blocks, missing membership and partial extracts unknown', () => {
    for (const types of [null, [5, 6, 1], [5, 6, 2], [5, 6, 3], [5, 6, 4], [5, 6, 9], [5, 6, -1], [5]]) {
      expect(penaltyContextGap(types, [commitment()])).toMatchObject({ status: 'unsupported_context', applications: [] });
    }
    expect(penaltyContextGap([5, 6, 6], [commitment(), { ...commitment(2), status: 'membership_unavailable' }]))
      .toMatchObject({ status: 'state_unavailable', reason: 'membership_unavailable' });
    expect(penaltyContextGap([5], [])).toMatchObject({ status: 'not_applicable' });
    expect(penaltyContextGap([5, 6], [{ ...commitment(), status: 'null' }])).toMatchObject({ status: 'not_applicable' });
  });

  it('withdraws all causal claims on registry or unrelated state changes', () => {
    const before = [node(1), node(2, { penalty: 5 })];
    const correct = [node(1, { penalty: 66 }), node(2, { penalty: 4 })];
    expect(replayPenaltyAttribution(100, [5, 6], [commitment()], before, correct).status).toBe('verified');
    expect(replayPenaltyAttribution(100, [5, 6], [commitment()], before, [correct[0]]))
      .toMatchObject({ status: 'unsupported_context', reason: 'registry_changed', applications: [] });
    for (const changed of [{ ...correct[1], penalty: 5 }, { ...correct[1], revivedHeight: 100 },
      { ...correct[1], dslBanHeight: 100 }, { ...correct[1], banHeight: 100 }]) {
      expect(replayPenaltyAttribution(100, [5, 6], [commitment()], before, [correct[0], changed]))
        .toMatchObject({ status: 'inconsistent', reason: 'state_mismatch', applications: [] });
    }
  });
});

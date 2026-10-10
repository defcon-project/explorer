import { describe, expect, it } from 'vitest';
import { banAttributionDataSchema } from '@defcon/shared/dist/contracts';
import { resolveBanAttribution } from '../src/domain/pose/banAttribution';
import { attributedBlock, attributionNow, attributionQuery } from './fixtures/banAttribution';
import { chainHash } from './fixtures/poseChain';

describe('exact BANNED_BY evidence', () => {
  it('returns the commitment that crosses the cap, not the earlier quorum in that block', () => {
    const result = resolveBanAttribution(attributedBlock(true), attributionQuery, attributionNow);
    expect(result.proof).toMatchObject({ txid: chainHash(1001), quorumType: 2, quorumHash: chainHash(901), memberValid: false,
      penalty: { beforePenalty: 66, afterPenalty: 100, appliedDelta: 34, previousBanHeight: -1, banHeight: 100, causedBan: true } });
  });
  it('does not infer a ban from valid membership, a different identity or a different requested height', () => {
    expect(resolveBanAttribution(attributedBlock(), { ...attributionQuery, proTxHash: chainHash(1) }, attributionNow).reason).toBe('ban_not_attributed');
    expect(resolveBanAttribution(attributedBlock(), { ...attributionQuery, proTxHash: chainHash(3) }, attributionNow).reason).toBe('ban_not_attributed');
    expect(resolveBanAttribution(attributedBlock(), { ...attributionQuery, banHeight: 101 }, attributionNow).proof).toBeNull();
  });
  it.each(['applications', 'unrelated_state', 'context', 'registry', 'member', 'base', 'duplicate_tx', 'future'])(
    'suppresses a claimed verified ban with inconsistent %s', (mutation) => {
      const block = attributedBlock();
      if (mutation === 'applications') block.penaltyAttribution.applications[0].appliedDelta = 999;
      if (mutation === 'unrelated_state') block.penaltyAttribution.after[0].penalty = 1;
      if (mutation === 'context') block.transactionTypes.push(10);
      if (mutation === 'registry') block.penaltyAttribution.registeredCount = 220;
      if (mutation === 'member') block.commitments[0].members[1].valid = true;
      if (mutation === 'base') block.commitments[0].quorumHash = 'missing';
      if (mutation === 'duplicate_tx') block.commitments.push(block.commitments[0]);
      if (mutation === 'future') block.attributionCheckedAt = new Date(attributionNow.getTime() + 1);
      expect(resolveBanAttribution(block, attributionQuery, attributionNow)).toEqual({ proof: null, reason: 'inconsistent' });
    });
  it('rejects a proof outside trusted coverage or with a fabricated penalty delta at the public contract', () => {
    const proof = resolveBanAttribution(attributedBlock(), attributionQuery, attributionNow).proof!;
    const valid = { ...attributionQuery, code: 'BANNED_BY', generatedAt: attributionNow.toISOString(),
      collectorStatus: 'ready', attributionEnabled: true, status: 'verified', evidence: 'chain_verified_penalty', reason: null,
      message: 'cause', hint: 'check logs', proof,
      coverage: { startHeight: 100, lastHeight: 102, lastHash: chainHash(102), targetHeight: 102,
        checkedAt: attributionNow.toISOString(), lastReorgAt: null, remainingBlocks: 0, caughtUp: true, confirmedThroughHeight: 102 } };
    expect(banAttributionDataSchema.safeParse(valid).success).toBe(true);
    for (const mutation of [ { ...valid, attributionEnabled: false }, { ...valid, collectorStatus: 'stale' },
      { ...valid, banHeight: 101 }, { ...valid, proTxHash: chainHash(1) },
      { ...valid, coverage: { ...valid.coverage, confirmedThroughHeight: 99 } },
      { ...valid, proof: { ...proof, penalty: { ...proof.penalty, appliedDelta: 999 } } } ]) {
      expect(banAttributionDataSchema.safeParse(mutation).success).toBe(false);
    }
    expect(banAttributionDataSchema.safeParse({ ...valid, status: 'unknown', evidence: 'unknown', reason: 'pending' }).success).toBe(false);
  });
});

import { z } from 'zod';
import { chainHashSchema } from './commitment';

// Pinned to defcon a06830f: DecreaseScores, HandleQuorumCommitment, PoSePunish.
// This deliberately supports a restricted block context, not a full Core replay.
export const POSE_PENALTY_RULE = 'defcon-v23-dkg-66' as const;
const height = z.number().int().min(-1).max(2147483647);
const stateSchema = z.object({
  PoSePenalty: z.number().int().min(0).max(2147483647),
  PoSeBanHeight: height, PoSeRevivedHeight: height, dslBanHeight: height,
});
export type PenaltyState = { proTxHash: string; penalty: number; banHeight: number; revivedHeight: number; dslBanHeight: number };
export type PenaltyApplication = {
  txid: string; proTxHash: string; previousBlockPenalty: number; beforePenalty: number; afterPenalty: number;
  penaltyAmount: number; appliedDelta: number; maxPenalty: number;
  previousBanHeight: number; banHeight: number; causedBan: boolean;
};
export type PenaltyAttribution = {
  status: 'disabled' | 'verified' | 'state_unavailable' | 'unsupported_context' | 'inconsistent' | 'not_applicable';
  reason: 'disabled' | 'no_commitments' | 'membership_unavailable' | 'other_state_changes' | 'registry_changed'
    | 'state_unavailable' | 'state_mismatch' | null;
  rule: typeof POSE_PENALTY_RULE;
  registeredCount: number | null; maxPenalty: number | null;
  before: PenaltyState[]; after: PenaltyState[]; applications: PenaltyApplication[];
};
export type AttributionCommitment = {
  txid: string; status: string; members: { proTxHash: string; valid: boolean }[];
};

export function emptyPenaltyAttribution(status: PenaltyAttribution['status'], reason: PenaltyAttribution['reason']): PenaltyAttribution {
  return { status, reason, rule: POSE_PENALTY_RULE, registeredCount: null, maxPenalty: null,
    before: [], after: [], applications: [] };
}

/** Full snapshot from genesis (empty DIP3 list) to an explicitly supplied block hash.
 * protx listdiff accepts hashes through ParseBlockIndex, despite its height help text.
 * Never persist service addresses, keys, wallet fields or the raw RPC response. */
export function parsePenaltySnapshot(value: unknown, blockHeight: number): PenaltyState[] {
  const snapshot = z.object({
    baseHeight: z.literal(0), blockHeight: z.literal(blockHeight),
    addedMNs: z.array(z.object({ proTxHash: chainHashSchema, state: stateSchema })).max(20000),
    removedMNs: z.array(z.unknown()).length(0), updatedMNs: z.array(z.unknown()).length(0),
  }).parse(value);
  const seen = new Set<string>();
  return snapshot.addedMNs.map(({ proTxHash, state }) => {
    if (seen.has(proTxHash) || [state.PoSeBanHeight, state.PoSeRevivedHeight, state.dslBanHeight].some((h) => h > blockHeight)) {
      throw new Error('Invalid historical PoSe state');
    }
    seen.add(proTxHash);
    return { proTxHash, penalty: state.PoSePenalty, banHeight: state.PoSeBanHeight,
      revivedHeight: state.PoSeRevivedHeight, dslBanHeight: state.dslBanHeight };
  }).sort((a, b) => a.proTxHash.localeCompare(b.proTxHash));
}

export function penaltyContextGap(types: number[] | null, commitments: AttributionCommitment[]): PenaltyAttribution | null {
  if (!commitments.length || commitments.every((c) => c.status === 'null')) return emptyPenaltyAttribution('not_applicable', 'no_commitments');
  if (!types || types.filter((type) => type === 6).length !== commitments.length
    || types.some((type) => ![0, 5, 6].includes(type))) {
    return emptyPenaltyAttribution('unsupported_context', 'other_state_changes');
  }
  if (commitments.some((c) => !['verified', 'null'].includes(c.status))) {
    return emptyPenaltyAttribution('state_unavailable', 'membership_unavailable');
  }
  return null;
}

export function replayPenaltyAttribution(blockHeight: number, transactionTypes: number[], commitments: AttributionCommitment[],
  before: PenaltyState[], after: PenaltyState[]): PenaltyAttribution {
  const gap = penaltyContextGap(transactionTypes, commitments);
  if (gap) return gap;
  const result: PenaltyAttribution = { ...emptyPenaltyAttribution('verified', null), before, after,
    registeredCount: before.length, maxPenalty: Math.max(100, before.length) };
  const actual = new Map(after.map((node) => [node.proTxHash, node]));
  if (before.length !== after.length || before.some((node) => !actual.has(node.proTxHash))) {
    return { ...result, status: 'unsupported_context', reason: 'registry_changed' };
  }
  const current = new Map(before.map((node) => [node.proTxHash, { ...node,
    penalty: node.penalty > 0 && node.banHeight === -1 && node.dslBanHeight === -1 ? node.penalty - 1 : node.penalty,
  }]));
  const previous = new Map(before.map((node) => [node.proTxHash, node]));
  const maximum = result.maxPenalty!;
  const amount = Math.floor(maximum * 66 / 100);
  const applications: PenaltyApplication[] = [];
  for (const commitment of commitments) {
    if (commitment.status === 'null') continue;
    for (const member of commitment.members) {
      const node = current.get(member.proTxHash);
      // HandleQuorumCommitment skips identities removed since the DKG base.
      if (member.valid || !node) continue;
      const beforePenalty = node.penalty; const previousBanHeight = node.banHeight;
      node.penalty = Math.min(maximum, beforePenalty + amount);
      const causedBan = node.penalty >= maximum && node.banHeight === -1 && node.dslBanHeight === -1;
      if (causedBan) node.banHeight = blockHeight;
      applications.push({ txid: commitment.txid, proTxHash: member.proTxHash,
        previousBlockPenalty: previous.get(member.proTxHash)!.penalty, beforePenalty, afterPenalty: node.penalty,
        penaltyAmount: amount, appliedDelta: node.penalty - beforePenalty, maxPenalty: maximum,
        previousBanHeight, banHeight: node.banHeight, causedBan });
    }
  }
  // Compare every registered node, not only the members being attributed. Any
  // unexplained change suppresses all causal claims for this block.
  for (const node of current.values()) {
    const expected = actual.get(node.proTxHash)!;
    if (node.penalty !== expected.penalty || node.banHeight !== expected.banHeight
      || node.revivedHeight !== expected.revivedHeight || node.dslBanHeight !== expected.dslBanHeight) {
      return { ...result, status: 'inconsistent', reason: 'state_mismatch' };
    }
  }
  return { ...result, applications };
}

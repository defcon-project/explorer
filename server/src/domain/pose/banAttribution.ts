import { z } from 'zod';
import { banAttributionProofSchema, posePenaltyApplicationSchema,
  type BanAttributionQuery, type BanAttributionProof, type BanAttributionUnknownReason } from '@defcon/shared/dist/contracts';
import { POSE_PENALTY_RULE, replayPenaltyAttribution } from './penaltyAttribution';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const score = z.number().int().min(0).max(2147483647);
const height = z.number().int().min(-1).max(2147483647);
const state = z.object({ proTxHash: hash, penalty: score, banHeight: height, revivedHeight: height, dslBanHeight: height });
const blockSchema = z.object({
  height: height, hash, previousHash: hash, canonical: z.literal(true), time: z.date(), attributionCheckedAt: z.date(),
  transactionTypes: z.array(z.number().int()).max(200000),
  commitments: z.array(z.object({ txid: hash, quorumType: z.number().int().min(0).max(255).nullable(), quorumHash: hash.nullable(),
    status: z.enum(['verified', 'null', 'membership_unavailable', 'unsupported_payload']),
    members: z.array(z.object({ proTxHash: hash, valid: z.boolean() })).max(20000) })).max(64),
  penaltyAttribution: z.object({ status: z.literal('verified'), reason: z.null(), rule: z.literal(POSE_PENALTY_RULE),
    registeredCount: score, maxPenalty: score,
    before: z.array(state).min(1).max(20000), after: z.array(state).min(1).max(20000),
    applications: z.array(posePenaltyApplicationSchema.extend({ txid: hash, proTxHash: hash })).max(20000) }),
});
type Resolution = { proof: BanAttributionProof; reason: null } | { proof: null; reason: BanAttributionUnknownReason };

/** Recheck the stored full-state replay. Membership or temporal proximity alone never supplies a cause. */
export function resolveBanAttribution(value: unknown, query: BanAttributionQuery, now: Date): Resolution {
  const parsed = blockSchema.safeParse(value);
  if (!parsed.success) return { proof: null, reason: 'inconsistent' };
  const block = parsed.data, a = block.penaltyAttribution;
  if (block.height !== query.banHeight || (query.blockHash && query.blockHash !== block.hash)
    || block.time > now || block.attributionCheckedAt > now
    || a.registeredCount !== a.before.length || a.maxPenalty !== Math.max(100, a.before.length)
    || new Set(a.before.map(n => n.proTxHash)).size !== a.before.length
    || new Set(a.after.map(n => n.proTxHash)).size !== a.after.length
    || a.before.some(n => [n.banHeight, n.revivedHeight, n.dslBanHeight].some(h => h >= block.height))
    || a.after.some(n => [n.banHeight, n.revivedHeight, n.dslBanHeight].some(h => h > block.height))
    || new Set(block.commitments.map(c => c.txid)).size !== block.commitments.length
    || block.commitments.some(c => new Set(c.members.map(m => m.proTxHash)).size !== c.members.length)) {
    return { proof: null, reason: 'inconsistent' };
  }
  const replay = replayPenaltyAttribution(block.height, block.transactionTypes, block.commitments, a.before, a.after);
  // Compare fields in explicit schema order; BSON object property order is irrelevant.
  const normalize = (apps: typeof a.applications) => apps.map(app => ({ txid: app.txid, proTxHash: app.proTxHash,
    ...posePenaltyApplicationSchema.parse(app) }));
  if (replay.status !== 'verified' || JSON.stringify(normalize(replay.applications)) !== JSON.stringify(normalize(a.applications))) {
    return { proof: null, reason: 'inconsistent' };
  }
  const bans = replay.applications.filter(app => app.proTxHash === query.proTxHash && app.causedBan);
  if (bans.length !== 1) return { proof: null, reason: bans.length ? 'ambiguous_attribution' : 'ban_not_attributed' };
  const app = bans[0], commitment = block.commitments.find(c => c.txid === app.txid)!;
  const proof = banAttributionProofSchema.safeParse({
    proTxHash: app.proTxHash,
    blockHeight: block.height, blockHash: block.hash, parentHash: block.previousHash,
    blockTime: block.time.toISOString(), checkedAt: block.attributionCheckedAt.toISOString(),
    txid: commitment.txid, quorumType: commitment.quorumType, quorumHash: commitment.quorumHash,
    rule: POSE_PENALTY_RULE, memberValid: false, penalty: posePenaltyApplicationSchema.parse(app), observerCount: 0,
  });
  return proof.success ? { proof: proof.data, reason: null } : { proof: null, reason: 'inconsistent' };
}

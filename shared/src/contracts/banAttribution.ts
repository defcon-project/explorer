import { z } from 'zod';
import { apiSuccessSchema } from './api';
import { poseChainDataSchema, posePenaltyApplicationSchema } from './poseChain';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const inputHash = z.string().regex(/^[a-fA-F0-9]{64}$/).transform(value => value.toLowerCase());
const height = z.number().int().min(1).max(2147483647);
export const banAttributionQuerySchema = z.object({
  proTxHash: inputHash,
  banHeight: z.union([height, z.string().regex(/^\d+$/).transform(Number).pipe(height)]),
  blockHash: inputHash.optional(),
}).strict();
export const banAttributionUnknownReasonSchema = z.enum([
  'collector_disabled', 'attribution_disabled', 'collector_unavailable', 'collector_collecting', 'collector_stale',
  'before_coverage', 'after_coverage', 'block_unavailable', 'block_hash_mismatch', 'pending',
  'state_unavailable', 'unsupported_context', 'inconsistent', 'not_applicable',
  'ban_not_attributed', 'ambiguous_attribution', 'read_invalidated',
]);
const common = {
  code: z.literal('BANNED_BY'), generatedAt: z.string().datetime({ offset: true }),
  proTxHash: hash, banHeight: height,
  collectorStatus: poseChainDataSchema.shape.status, attributionEnabled: z.boolean(),
  coverage: poseChainDataSchema.shape.coverage,
};
export const banAttributionProofSchema = z.object({
  proTxHash: hash,
  blockHeight: height, blockHash: hash, parentHash: hash,
  blockTime: z.string().datetime({ offset: true }), checkedAt: z.string().datetime({ offset: true }),
  txid: hash, quorumType: z.number().int().min(0).max(255), quorumHash: hash,
  rule: z.literal('defcon-v23-dkg-66'), memberValid: z.literal(false),
  penalty: posePenaltyApplicationSchema.extend({ causedBan: z.literal(true) }),
  observerCount: z.number().int().safe().nonnegative(),
}).superRefine((proof, ctx) => {
  const p = proof.penalty;
  if (p.previousBanHeight !== -1 || p.banHeight !== proof.blockHeight || p.afterPenalty !== p.maxPenalty
    || p.penaltyAmount !== Math.floor(p.maxPenalty * 66 / 100)
    || p.afterPenalty !== Math.min(p.maxPenalty, p.beforePenalty + p.penaltyAmount)
    || p.appliedDelta !== p.afterPenalty - p.beforePenalty) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['penalty'], message: 'Inconsistent ban evidence' });
  }
});
export const banAttributionDataSchema = z.discriminatedUnion('status', [
  z.object({ ...common, status: z.literal('unknown'), evidence: z.literal('unknown'),
    reason: banAttributionUnknownReasonSchema, proof: z.null(), message: z.string(), hint: z.string() }),
  z.object({ ...common, status: z.literal('verified'), evidence: z.literal('chain_verified_penalty'),
    reason: z.null(), proof: banAttributionProofSchema, message: z.string(), hint: z.string() }),
]).superRefine((data, ctx) => {
  if (data.status === 'verified' && (!data.attributionEnabled || data.collectorStatus !== 'ready'
    || data.proTxHash !== data.proof.proTxHash
    || data.banHeight !== data.proof.blockHeight || data.banHeight < data.coverage.startHeight
    || data.banHeight > data.coverage.confirmedThroughHeight)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['proof'], message: 'Ban evidence outside trusted coverage' });
  }
});
export const banAttributionApiResponseSchema = apiSuccessSchema(banAttributionDataSchema);
export type BanAttributionQuery = z.infer<typeof banAttributionQuerySchema>;
export type BanAttributionData = z.infer<typeof banAttributionDataSchema>;
export type BanAttributionProof = z.infer<typeof banAttributionProofSchema>;
export type BanAttributionUnknownReason = z.infer<typeof banAttributionUnknownReasonSchema>;

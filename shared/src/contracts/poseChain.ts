import { z } from 'zod';
import { apiSuccessSchema } from './api';

const integer = z.number().int().safe().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const dateTime = z.string().datetime({ offset: true });
export const posePenaltyAttributionStatusSchema = z.enum(['disabled', 'pending', 'verified', 'state_unavailable',
  'unsupported_context', 'inconsistent', 'not_applicable']);
const penaltyApplicationSchema = z.object({
  previousBlockPenalty: integer, beforePenalty: integer, afterPenalty: integer,
  penaltyAmount: integer, appliedDelta: z.number().int(), maxPenalty: z.number().int().min(100),
  previousBanHeight: z.number().int().min(-1), banHeight: z.number().int().min(-1), causedBan: z.boolean(),
});
export const poseChainQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(8760).default(24),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  quorumType: z.coerce.number().int().min(0).max(255).optional(),
  proTxHash: z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase()).optional(),
});
export const poseChainDataSchema = z.object({
  generatedAt: dateTime,
  status: z.enum(['disabled', 'unavailable', 'collecting', 'stale', 'ready']),
  coverage: z.object({
    startHeight: integer, lastHeight: z.number().int(), lastHash: hash.nullable(),
    targetHeight: integer.nullable(), checkedAt: dateTime.nullable(), lastReorgAt: dateTime.nullable(),
    remainingBlocks: integer.nullable(), caughtUp: z.boolean(),
    confirmedThroughHeight: z.number().int(),
  }),
  windowHours: integer, page: integer, limit: integer, total: integer,
  penaltyCoverage: z.object({ enabled: z.boolean(), commitmentBlocks: integer, verifiedBlocks: integer,
    pendingBlocks: integer, unavailableBlocks: integer, unsupportedBlocks: integer, inconsistentBlocks: integer,
    notApplicableBlocks: integer }),
  quorumSummary: z.array(z.object({
    quorumType: integer.nullable(), commitments: integer, verifiedCommitments: integer,
    unavailableCommitments: integer, nullCommitments: integer,
    participants: integer, invalidMembers: integer,
    penaltyApplications: integer, newBans: integer, unknownPenaltyCommitments: integer,
  })),
  commitments: z.array(z.object({
    blockHeight: integer, blockHash: hash, blockTime: dateTime, txid: hash,
    quorumType: integer.nullable(), quorumHash: hash.nullable(), version: integer.nullable(),
    quorumIndex: integer.nullable(), memberSlots: integer.nullable(), invalidSlots: integer.nullable(),
    membershipStatus: z.enum(['verified', 'null', 'membership_unavailable', 'unsupported_payload']),
    evidence: z.enum(['chain_verified_membership', 'unknown']),
    participantCount: integer, invalidMemberCount: integer,
    observerCount: integer,
    penaltyAttributionStatus: posePenaltyAttributionStatusSchema,
    penaltyAttributionReason: z.enum(['disabled', 'no_commitments', 'membership_unavailable', 'other_state_changes',
      'registry_changed', 'state_unavailable', 'state_mismatch']).nullable(),
    penaltyRule: z.literal('defcon-v23-dkg-66').nullable(),
    members: z.array(z.object({ proTxHash: hash, valid: z.boolean(), observerCount: integer,
      penaltyEvidence: z.enum(['chain_verified_penalty', 'unknown', 'not_applicable']),
      penaltyReason: z.enum(['valid_member', 'not_registered', 'attribution_unavailable']).nullable(),
      penalty: penaltyApplicationSchema.nullable(),
    })),
  }).superRefine((commitment, ctx) => {
    commitment.members.forEach((member, index) => {
      const penalty = member.penalty;
      const verified = member.penaltyEvidence === 'chain_verified_penalty';
      if (verified !== Boolean(penalty) || (verified && (member.valid || commitment.penaltyAttributionStatus !== 'verified'
        || commitment.evidence !== 'chain_verified_membership' || commitment.penaltyRule === null || member.penaltyReason !== null))
        || (penalty && (penalty.appliedDelta !== penalty.afterPenalty - penalty.beforePenalty
          || penalty.penaltyAmount !== Math.floor(penalty.maxPenalty * 66 / 100)
          || penalty.afterPenalty !== Math.min(penalty.maxPenalty, penalty.beforePenalty + penalty.penaltyAmount)
          || (penalty.causedBan && (penalty.banHeight !== commitment.blockHeight || penalty.previousBanHeight !== -1
            || penalty.afterPenalty !== penalty.maxPenalty))))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['members', index, 'penalty'], message: 'Inconsistent penalty evidence' });
      }
    });
  })),
});
export const poseChainApiResponseSchema = apiSuccessSchema(poseChainDataSchema);
export type PoseChainQuery = z.infer<typeof poseChainQuerySchema>;
export type PoseChainData = z.infer<typeof poseChainDataSchema>;

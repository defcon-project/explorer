import { z } from 'zod';
import { apiSuccessSchema } from './api';
import { networkNoiseRoleSchema } from './nodeMonitoring';

const hash = z.string().trim().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const integer = z.number().int().safe().nonnegative();
const dateTime = z.string().datetime({ offset: true });

export const poseEventKindSchema = z.enum([
  'penalty_change', 'ban', 'recovery', 'dkg_member', 'quorum_build_failure',
]);

/** Agent claims only. Neither block identifiers nor quorum fields establish canonicality. */
export const poseTelemetryEventSchema = z.object({
  eventId: z.string().trim().min(8).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
  kind: poseEventKindSchema,
  eventAt: dateTime,
  eventBlockHeight: integer.nullable(),
  eventBlockHash: hash.nullable(),
  quorumType: z.number().int().min(0).max(255).nullable(),
  quorumHash: hash.nullable(),
  proTxHash: hash.nullable(),
  previousPenalty: integer.nullable(),
  penalty: integer.nullable(),
  poseBanHeight: integer.nullable(),
  memberValid: z.boolean().nullable(),
  sample: z.string().trim().max(300).nullable().optional(),
}).superRefine((event, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (event.kind !== 'quorum_build_failure' && !event.proTxHash) {
    issue('proTxHash', 'A member event requires proTxHash');
  }
  if (event.kind === 'penalty_change' && (event.previousPenalty === null || event.penalty === null)) {
    issue('penalty', 'A penalty change requires both scores');
  }
  if (event.kind === 'ban' && (event.poseBanHeight === null || event.poseBanHeight === 0)) {
    issue('poseBanHeight', 'A ban requires a positive ban height');
  }
  if (event.kind === 'dkg_member' && (event.quorumType === null || !event.quorumHash || event.memberValid === null)) {
    issue('quorumHash', 'A DKG member requires quorum identity and validity');
  }
  if (event.kind !== 'dkg_member' && event.memberValid !== null) {
    issue('memberValid', 'Member validity belongs to a DKG member observation');
  }
});

const nullableInt = integer.nullable().optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const batch = z.object({
  agentVersion: z.string().trim().min(1).max(32),
  nodeId: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  nodeRole: networkNoiseRoleSchema,
  observedAt: dateTime,
  sequence: integer,
  snapshot: z.object({
    ip: z.string().ip(),
    walletVersion: nullableText(64),
    blockHeight: nullableInt,
    bestBlockHash: nullableText(64),
    chainLockHeight: nullableInt,
    chainLockHash: nullableText(64),
    connections: nullableInt,
    inbound: nullableInt,
    outbound: nullableInt,
    syncing: z.boolean().nullable().optional(),
  }),
  signals: z.array(z.object({
    type: z.string().trim().min(1).max(64).regex(/^[a-z0-9_]+$/),
    fingerprint: z.string().trim().min(8).max(128),
    count: z.number().int().min(1).max(100000),
    firstSeenAt: dateTime,
    lastSeenAt: dateTime,
    peerIps: z.array(z.string().ip()).max(20).optional(),
    sample: nullableText(300),
  })).max(100),
});

export const networkNoiseIngestSchema = z.discriminatedUnion('schemaVersion', [
  batch.extend({ schemaVersion: z.literal(1) }),
  batch.extend({
    schemaVersion: z.literal(2),
    poseEvents: z.array(poseTelemetryEventSchema).max(100).refine(
      (events) => new Set(events.map((event) => event.eventId)).size === events.length,
      'eventId must be unique within a batch',
    ),
  }),
]);

export const poseEventsQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(8760).default(24),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  kind: poseEventKindSchema.optional(),
  quorumType: z.coerce.number().int().min(0).max(255).optional(),
  proTxHash: hash.optional(),
});

const scoreVariant = z.object({
  previousPenalty: integer.nullable(),
  penalty: integer.nullable(),
  poseBanHeight: integer.nullable(),
  memberValid: z.boolean().nullable(),
});
export const poseObservedEventSchema = z.object({
  eventKey: hash,
  kind: poseEventKindSchema,
  identityComplete: z.boolean(),
  evidence: z.literal('log_observed'),
  canonicalStatus: z.literal('unverified'),
  eventBlockHeight: integer.nullable(),
  eventBlockHash: hash.nullable(),
  quorumType: z.number().int().min(0).max(255).nullable(),
  quorumHash: hash.nullable(),
  proTxHash: hash.nullable(),
  firstEventAt: dateTime,
  lastEventAt: dateTime,
  lastReportedAt: dateTime,
  observerCount: integer,
  observerNodeIds: z.array(z.string()),
  observerRoles: z.array(networkNoiseRoleSchema),
  observationCount: integer,
  scoreVariants: z.array(scoreVariant),
  hasConflictingScores: z.boolean(),
  sample: z.string().max(300).nullable(),
});
export const poseObservedEventsSchema = z.object({
  generatedAt: dateTime,
  windowHours: integer.positive(),
  retentionDays: integer.positive(),
  page: integer.positive(),
  limit: integer.positive(),
  total: integer,
  observationCount: integer,
  uncorrelatedEvents: integer,
  chainVerifiedEvents: z.literal(0),
  events: z.array(poseObservedEventSchema),
});
export const poseObservedEventsApiResponseSchema = apiSuccessSchema(poseObservedEventsSchema);

export type PoseTelemetryEvent = z.infer<typeof poseTelemetryEventSchema>;
export type NetworkNoiseIngestPayload = z.infer<typeof networkNoiseIngestSchema>;
export type PoseEventsQuery = z.infer<typeof poseEventsQuerySchema>;
export type PoseObservedEventsContract = z.infer<typeof poseObservedEventsSchema>;

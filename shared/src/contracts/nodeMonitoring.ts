import { z } from 'zod';
import { apiSuccessSchema } from './api';

const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().int().nonnegative();
const nullableInteger = z.number().int().nullable();
const isoDateTime = z.string().datetime({ offset: true });

export const nodeInventoryChainStatusSchema = z.enum([
  'main_chain',
  'ahead',
  'behind',
  'hash_mismatch',
  'unknown',
]);

export const nodeInventoryNodeSchema = z
  .object({
    nodeKey: z.string().min(1),
    ip: z.string().min(1),
    port: nonNegativeInteger,
    sources: z.array(z.string()),
    labels: z.array(z.string()),
    walletVersion: z.string().nullable(),
    protocolVersion: nullableInteger,
    blockHeight: nullableInteger,
    bestBlockHash: z.string().nullable(),
    connections: nullableInteger,
    syncProgress: finiteNumber.nullable(),
    nodeStatus: z.string().nullable(),
    chainStatus: nodeInventoryChainStatusSchema,
    blocksDelta: z.number().int().nullable(),
    masternodeProTxHash: z.string().nullable(),
    masternodeStatus: z.string().nullable(),
    firstSeenAt: isoDateTime,
    lastSeenAt: isoDateTime.nullable(),
    lastObservedAt: isoDateTime,
    isDeprecated: z.boolean(),
    isStale: z.boolean(),
  })
  // Mongo documents expose a few legacy metadata fields. Do not remove them
  // from an unversioned public response while making the consumed shape exact.
  .passthrough();

export const nodeInventorySchema = z.object({
  generatedAt: isoDateTime,
  requiredVersion: z.string().min(1),
  staleAfterSeconds: nonNegativeInteger,
  summary: z.object({
    observed: nonNegativeInteger,
    knownVersion: nonNegativeInteger,
    recommended: nonNegativeInteger,
    deprecated: nonNegativeInteger,
    mainChain: nonNegativeInteger,
    chainRisk: nonNegativeInteger,
    stale: nonNegativeInteger,
  }),
  versions: z.array(z.object({ version: z.string(), count: nonNegativeInteger })),
  total: nonNegativeInteger,
  nodes: z.array(nodeInventoryNodeSchema),
});

export const networkVersionSampleNodeSchema = z.object({
  ip: z.string().min(1),
  port: nonNegativeInteger,
  walletVersion: z.string().min(1),
  protocolVersion: nullableInteger,
  blockHeight: nullableInteger,
  sources: z.array(z.string()),
  lastSeenAt: isoDateTime.nullable(),
  lastObservedAt: isoDateTime,
  lastVersionObservedAt: isoDateTime.nullable(),
  isDeprecated: z.boolean(),
});

export const networkVersionSampleSchema = z.object({
  generatedAt: isoDateTime,
  windowHours: nonNegativeInteger.positive(),
  requiredVersion: z.string().min(1),
  summary: z.object({
    observed: nonNegativeInteger,
    identified: nonNegativeInteger,
    unidentified: nonNegativeInteger,
    coveragePct: finiteNumber,
    recommended: nonNegativeInteger,
    deprecated: nonNegativeInteger,
  }),
  versions: z.array(
    z.object({
      version: z.string().min(1),
      count: nonNegativeInteger,
      observedSharePct: finiteNumber,
      sharePct: finiteNumber,
      isDeprecated: z.boolean(),
    })
  ),
  nodes: z.array(networkVersionSampleNodeSchema),
});

export const networkNoiseLevelSchema = z.enum(['quiet', 'elevated', 'noisy', 'severe', 'critical']);
export const networkNoiseRoleSchema = z.enum(['seed', 'fullnode', 'test_mn', 'masternode', 'unknown']);

export const networkNoiseNodeSchema = z.object({
  nodeId: z.string().min(1),
  nodeRole: networkNoiseRoleSchema,
  walletVersion: z.string().nullable(),
  agentVersion: z.string().nullable(),
  lastReportedAt: isoDateTime,
  blockHeight: nullableInteger,
  bestBlockHash: z.string().nullable(),
  chainLockHeight: nullableInteger,
  chainLockHash: z.string().nullable(),
  connections: nullableInteger,
  inbound: nullableInteger,
  outbound: nullableInteger,
  syncing: z.boolean().nullable(),
  noiseScore: nonNegativeInteger,
  signalCount: nonNegativeInteger,
  activeSignalTypes: z.array(z.string()),
  lastCleanAt: isoDateTime.nullable(),
  isStale: z.boolean(),
});

export const networkNoiseTimelineEntrySchema = z.object({
  bucket: isoDateTime,
  signalType: z.string().min(1),
  count: nonNegativeInteger,
  nodes: z.array(z.string()),
});

export const networkNoiseSignalSchema = z.object({
  nodeId: z.string().min(1),
  nodeRole: z.string().min(1),
  walletVersion: z.string().nullable(),
  signalType: z.string().min(1),
  fingerprint: z.string().min(1),
  count: nonNegativeInteger,
  firstSeenAt: isoDateTime,
  lastSeenAt: isoDateTime,
  sample: z.string().nullable(),
  blockHeight: nullableInteger,
  bestBlockHash: z.string().nullable(),
  chainLockHeight: nullableInteger,
  chainLockHash: z.string().nullable(),
});

export const networkNoiseSummarySchema = z.object({
  generatedAt: isoDateTime,
  windowHours: nonNegativeInteger.positive(),
  staleAfterSeconds: nonNegativeInteger,
  summary: z.object({
    currentScore: nonNegativeInteger,
    currentLevel: networkNoiseLevelSchema,
    knownNodes: nonNegativeInteger,
    reportingNodes: nonNegativeInteger,
    staleNodes: nonNegativeInteger,
    activeSignals: nonNegativeInteger,
    chainAlerts: nonNegativeInteger,
  }),
  nodes: z.array(networkNoiseNodeSchema),
  timeline: z.array(networkNoiseTimelineEntrySchema),
  recentSignals: z.array(networkNoiseSignalSchema),
});

export const nodeInventoryApiResponseSchema = apiSuccessSchema(nodeInventorySchema);
export const networkVersionSampleApiResponseSchema = apiSuccessSchema(networkVersionSampleSchema);
export const networkNoiseSummaryApiResponseSchema = apiSuccessSchema(networkNoiseSummarySchema);

export type NodeInventoryChainStatusContract = z.infer<typeof nodeInventoryChainStatusSchema>;
export type NodeInventoryNodeContract = z.infer<typeof nodeInventoryNodeSchema>;
export type NodeInventoryContract = z.infer<typeof nodeInventorySchema>;
export type NetworkVersionSampleNodeContract = z.infer<typeof networkVersionSampleNodeSchema>;
export type NetworkVersionSampleContract = z.infer<typeof networkVersionSampleSchema>;
export type NetworkNoiseLevelContract = z.infer<typeof networkNoiseLevelSchema>;
export type NetworkNoiseNodeContract = z.infer<typeof networkNoiseNodeSchema>;
export type NetworkNoiseTimelineEntryContract = z.infer<typeof networkNoiseTimelineEntrySchema>;
export type NetworkNoiseSignalContract = z.infer<typeof networkNoiseSignalSchema>;
export type NetworkNoiseSummaryContract = z.infer<typeof networkNoiseSummarySchema>;
export type NodeInventoryApiResponse = z.infer<typeof nodeInventoryApiResponseSchema>;
export type NetworkVersionSampleApiResponse = z.infer<typeof networkVersionSampleApiResponseSchema>;
export type NetworkNoiseSummaryApiResponse = z.infer<typeof networkNoiseSummaryApiResponseSchema>;

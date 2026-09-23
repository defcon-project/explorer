import { z } from 'zod';
import { apiSuccessSchema } from './api';

const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().int().nonnegative();
const nullableInteger = z.number().int().nullable();
const nullableText = z.string().nullable();
const isoDateTime = z.string().datetime({ offset: true });

export const banWaveSeveritySchema = z.enum(['low', 'moderate', 'high', 'critical']);
export const historicalBanStatusSchema = z.enum(['banned', 'recovered', 'still_banned']);

/** Stored status transition, normalized at the HTTP boundary. */
export const masternodeEventSchema = z
  .object({
    _id: z.string().optional(),
    nodeId: z.string().min(1),
    service: z.string(),
    previousStatus: z.string(),
    currentStatus: z.string(),
    detectedAt: isoDateTime,
    ip: nullableText.optional(),
    countryCode: nullableText.optional(),
    countryName: nullableText.optional(),
    provider: nullableText.optional(),
    providerSource: nullableText.optional(),
    providerTagCidr: nullableText.optional(),
    providerTagSource: nullableText.optional(),
    providerConfidence: finiteNumber.nullable().optional(),
    asn: nullableInteger.optional(),
    asnOrg: nullableText.optional(),
  })
  // Preserve unversioned historical fields alongside the documented event
  // shape. The explicit keys are the only keys the UI may depend on.
  .passthrough();

export const masternodeHealthSnapshotSchema = z.object({
  total: nonNegativeInteger,
  enabled: nonNegativeInteger,
  poseBanned: nonNegativeInteger,
  posePenalty: nonNegativeInteger,
  new: nonNegativeInteger,
  other: z.number().int(),
  withPoseBanHeight: nonNegativeInteger,
  healthScore: finiteNumber,
  statusCounts: z.record(nonNegativeInteger),
});

export const masternodeHealthTimelinePointSchema = z.object({
  bucket: z.string(),
  timestamp: nonNegativeInteger,
  poseBanned: nonNegativeInteger,
  removed: nonNegativeInteger,
  total: nonNegativeInteger,
});

export const masternodeOffenderSchema = z.object({
  nodeId: z.string().min(1),
  dropCount: nonNegativeInteger,
  poseBannedCount: nonNegativeInteger,
  removedCount: nonNegativeInteger,
  lastDropAt: isoDateTime,
  lastService: z.string(),
  currentStatus: z.string(),
  countryCode: z.string(),
  countryName: z.string(),
  proTxHash: nullableText,
  payoutAddress: nullableText,
  isCurrentlyDown: z.boolean(),
  ip: nullableText,
  provider: nullableText,
  providerSource: nullableText,
  providerTagCidr: nullableText,
  providerTagSource: nullableText,
  providerConfidence: finiteNumber.nullable(),
  asn: nullableInteger,
  asnOrg: nullableText,
});

export const masternodeClusterNodeSchema = z.object({
  nodeId: z.string().min(1),
  proTxHash: nullableText,
  service: z.string(),
  ip: z.string(),
  status: z.string(),
  countryCode: z.string(),
  payoutAddress: nullableText,
  provider: nullableText,
  asn: nullableInteger,
  asnOrg: nullableText,
});

export const masternodeClusterSchema = z.object({
  key: z.string(),
  totalNodes: nonNegativeInteger,
  bannedNodes: nonNegativeInteger,
  evidence: z.enum(['weak', 'moderate', 'strong', 'critical']),
  dominantProvider: z
    .object({
      name: z.string(),
      count: nonNegativeInteger,
      share: finiteNumber,
    })
    .nullable(),
  nodes: z.array(masternodeClusterNodeSchema),
});

export const masternodePoseWatchEntrySchema = z.object({
  nodeId: z.string().min(1),
  proTxHash: nullableText,
  service: z.string(),
  ip: nullableText,
  port: nullableInteger,
  countryCode: z.string(),
  countryName: z.string(),
  status: z.string(),
  posePenalty: nonNegativeInteger,
  payoutAddress: nullableText,
  walletVersion: nullableText,
  protocolVersion: nullableInteger,
  peerCount: nullableInteger,
});

export const masternodeBanWaveSchema = z.object({
  startedAt: isoDateTime,
  windowSeconds: nonNegativeInteger,
  totalNodes: nonNegativeInteger,
  ips: z.array(z.string()),
  countries: z.array(z.string()),
  nodes: z.array(
    z.object({
      nodeId: z.string().min(1),
      service: z.string(),
      proTxHash: nullableText,
      countryCode: z.string(),
    })
  ),
});

export const masternodeHealthSchema = z.object({
  generatedAt: isoDateTime,
  windowHours: nonNegativeInteger.positive(),
  bucket: z.enum(['hour', 'day']),
  rpcAvailable: z.boolean(),
  snapshot: masternodeHealthSnapshotSchema,
  timeline: z.array(masternodeHealthTimelinePointSchema),
  offenders: z.array(masternodeOffenderSchema),
  recentEvents: z.array(masternodeEventSchema),
  statusBreakdown: z.array(z.object({ status: z.string(), count: nonNegativeInteger })),
  clusters: z.object({
    operator: z.array(masternodeClusterSchema),
    ip: z.array(masternodeClusterSchema),
    subnet: z.array(masternodeClusterSchema),
  }),
  poseWatchlist: z.array(masternodePoseWatchEntrySchema),
  banWaves: z.array(masternodeBanWaveSchema),
});

export const masternodeEventsSchema = z.object({
  windowHours: nonNegativeInteger.positive(),
  count: nonNegativeInteger,
  events: z.array(masternodeEventSchema),
});

export const banWaveDetailNodeSchema = z.object({
  nodeId: z.string().min(1),
  service: z.string(),
  previousStatus: z.string(),
  proTxHash: nullableText,
  countryCode: z.string(),
  countryName: z.string(),
  ip: z.string(),
  operatorPubkey: nullableText,
  payoutAddress: nullableText,
  atIso: isoDateTime,
  detectedAt: isoDateTime,
  recoveredAt: isoDateTime.nullable(),
  recoveredHeight: nullableInteger,
  recoveryTransition: nullableText,
  status: historicalBanStatusSchema,
  poseBanHeight: nullableInteger,
  detectedHeight: nullableInteger,
  provider: nullableText,
  providerSource: nullableText,
  providerTagCidr: nullableText,
  providerTagSource: nullableText,
  providerConfidence: finiteNumber.nullable(),
  asn: nullableInteger,
  asnOrg: nullableText,
  walletVersion: nullableText,
  protocolVersion: nullableInteger,
  versionObservedAt: isoDateTime.nullable(),
});

export const banWaveDetailSchema = z.object({
  id: z.string().min(1),
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  durationSeconds: nonNegativeInteger,
  windowSeconds: nonNegativeInteger,
  totalNodes: nonNegativeInteger,
  bannedCount: nonNegativeInteger,
  recoveredCount: nonNegativeInteger,
  stillBannedCount: nonNegativeInteger,
  uniqueIps: nonNegativeInteger,
  uniqueOperators: nonNegativeInteger,
  uniqueCountries: nonNegativeInteger,
  countries: z.array(z.string()),
  providers: z.array(z.string()),
  versions: z.array(z.string()),
  severity: banWaveSeveritySchema,
  severityScore: finiteNumber,
  nodes: z.array(banWaveDetailNodeSchema),
});

export const banWaveTimelinePointSchema = z.object({
  bucket: z.string(),
  timestamp: nonNegativeInteger,
  waveBans: nonNegativeInteger,
  isolatedBans: nonNegativeInteger,
  recovered: nonNegativeInteger,
  stillBanned: nonNegativeInteger,
  total: nonNegativeInteger,
  cumulative: nonNegativeInteger,
});

export const banWaveAnalysisSchema = z.object({
  generatedAt: isoDateTime,
  windowHours: nonNegativeInteger.positive(),
  windowMinutes: nonNegativeInteger.positive(),
  minNodes: nonNegativeInteger.positive(),
  bucket: z.enum(['auto', '15min', 'hour', 'day']),
  rpcAvailable: z.boolean(),
  currentPoseBanned: nonNegativeInteger,
  currentPosePenalty: nonNegativeInteger,
  currentValid: nonNegativeInteger,
  registeredTotal: nonNegativeInteger,
  freshDrops24h: nonNegativeInteger,
  freshDropEvents24h: nonNegativeInteger,
  observedAlreadyBanned24h: nonNegativeInteger,
  kpis: z.object({
    totalBans: nonNegativeInteger,
    uniqueBannedNodes: nonNegativeInteger,
    waveCount: nonNegativeInteger,
    windowWaveCount: nonNegativeInteger,
    nodesInWaves: nonNegativeInteger,
    windowNodesInWaves: nonNegativeInteger,
    largestWave: nonNegativeInteger,
    windowLargestWave: nonNegativeInteger,
    freshDrops24h: nonNegativeInteger,
    freshDropEvents24h: nonNegativeInteger,
    observedAlreadyBanned24h: nonNegativeInteger,
    currentPoseBanned: nonNegativeInteger,
    currentPosePenalty: nonNegativeInteger,
    currentValid: nonNegativeInteger,
    registeredTotal: nonNegativeInteger,
    uniqueCountries: nonNegativeInteger,
    meanTimeBetweenWavesSec: finiteNumber.nullable(),
  }),
  timeline: z.array(banWaveTimelinePointSchema),
  timelineModes: z.object({
    fresh: z.array(banWaveTimelinePointSchema),
    recovered: z.array(banWaveTimelinePointSchema),
    still: z.array(banWaveTimelinePointSchema),
    all: z.array(banWaveTimelinePointSchema),
  }),
  eventBreakdown: z.object({
    freshBans: nonNegativeInteger,
    freshDropEvents24h: nonNegativeInteger,
    allBanEvents: nonNegativeInteger,
    poseBanHeightEvents: nonNegativeInteger,
    historicalDropEvents: nonNegativeInteger,
    recoveredEvents: nonNegativeInteger,
    stillBannedEvents: nonNegativeInteger,
    observedAlreadyBanned: nonNegativeInteger,
    observedAlreadyBanned24h: nonNegativeInteger,
    enabledToBanned: nonNegativeInteger,
    penaltyToBanned: nonNegativeInteger,
    uniqueFreshNodes: nonNegativeInteger,
    uniqueAllNodes: nonNegativeInteger,
  }),
  waveBands: z.array(
    z.object({ x1: z.string(), x2: z.string(), severity: banWaveSeveritySchema })
  ),
  countryBreakdown: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      wave: nonNegativeInteger,
      isolated: nonNegativeInteger,
      total: nonNegativeInteger,
    })
  ),
  providerBreakdown: z.array(
    z.object({
      provider: z.string(),
      wave: nonNegativeInteger,
      isolated: nonNegativeInteger,
      tagged: nonNegativeInteger,
      auto: nonNegativeInteger,
      total: nonNegativeInteger,
    })
  ),
  providerSourceBreakdown: z.array(
    z.object({ source: z.string(), count: nonNegativeInteger, sharePct: finiteNumber })
  ),
  reliabilityCohorts: z.object({
    totalLiveNodes: nonNegativeInteger,
    never: nonNegativeInteger,
    once: nonNegativeInteger,
    repeat2to3: nonNegativeInteger,
    repeat4plus: nonNegativeInteger,
  }),
  providerReliability: z.array(
    z.object({
      provider: z.string(),
      totalNodes: nonNegativeInteger,
      never: nonNegativeInteger,
      once: nonNegativeInteger,
      repeat2to3: nonNegativeInteger,
      repeat4plus: nonNegativeInteger,
      repeated: nonNegativeInteger,
      repeatedPct: finiteNumber,
    })
  ),
  waves: z.array(banWaveDetailSchema),
});

export const masternodeHealthApiResponseSchema = apiSuccessSchema(masternodeHealthSchema);
export const masternodeEventsApiResponseSchema = apiSuccessSchema(masternodeEventsSchema);
export const banWaveAnalysisApiResponseSchema = apiSuccessSchema(banWaveAnalysisSchema);

export type MasternodeEventContract = z.infer<typeof masternodeEventSchema>;
export type MasternodeHealthSnapshotContract = z.infer<typeof masternodeHealthSnapshotSchema>;
export type MasternodeHealthTimelinePointContract = z.infer<typeof masternodeHealthTimelinePointSchema>;
export type MasternodeOffenderContract = z.infer<typeof masternodeOffenderSchema>;
export type MasternodeClusterNodeContract = z.infer<typeof masternodeClusterNodeSchema>;
export type MasternodeClusterContract = z.infer<typeof masternodeClusterSchema>;
export type MasternodePoseWatchEntryContract = z.infer<typeof masternodePoseWatchEntrySchema>;
export type MasternodeBanWaveContract = z.infer<typeof masternodeBanWaveSchema>;
export type MasternodeHealthContract = z.infer<typeof masternodeHealthSchema>;
export type MasternodeEventsContract = z.infer<typeof masternodeEventsSchema>;
export type BanWaveDetailNodeContract = z.infer<typeof banWaveDetailNodeSchema>;
export type BanWaveDetailContract = z.infer<typeof banWaveDetailSchema>;
export type BanWaveTimelinePointContract = z.infer<typeof banWaveTimelinePointSchema>;
export type BanWaveAnalysisContract = z.infer<typeof banWaveAnalysisSchema>;
export type MasternodeHealthApiResponse = z.infer<typeof masternodeHealthApiResponseSchema>;
export type MasternodeEventsApiResponse = z.infer<typeof masternodeEventsApiResponseSchema>;
export type BanWaveAnalysisApiResponse = z.infer<typeof banWaveAnalysisApiResponseSchema>;

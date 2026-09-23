import { z } from 'zod';
import { apiSuccessSchema } from './api';

const finiteNumber = z.number().finite();
const integer = z.number().int();
const nullableInteger = integer.nullable();
const providerSourceSchema = z.enum(['tor', 'cache', 'ptr', 'mmdb', 'ipapi', 'tag', 'unknown']);

export const masternodeCountrySchema = z.object({
  countryCode: z.string(),
  countryName: z.string(),
  count: integer.nonnegative(),
});

export const masternodeProviderSchema = z.object({
  provider: z.string(),
  count: integer.nonnegative(),
  tagged: integer.nonnegative().optional(),
  auto: integer.nonnegative().optional(),
});

export const masternodeSnapshotMetaSchema = z.object({
  snapshotId: z.string().min(1),
  observedAt: z.string().datetime({ offset: true }),
});

export const masternodeNodeSchema = z
  .object({
    id: z.string().min(1),
    service: z.string(),
    ip: z.string(),
    port: nullableInteger,
    status: z.string(),
    protocol: nullableInteger,
    lastSeen: nullableInteger,
    activeSeconds: nullableInteger,
    isTor: z.boolean(),
    countryCode: z.string(),
    countryName: z.string(),
    proTxHash: z.string().nullable(),
    ownerAddress: z.string().nullable(),
    payoutAddress: z.string().nullable(),
    collateralAddress: z.string().nullable(),
    registeredHeight: nullableInteger,
    registeredAt: nullableInteger,
    poseBanHeight: nullableInteger,
    poseBanAt: nullableInteger,
    collateralAmount: finiteNumber.nullable(),
    provider: z.string(),
    providerSource: providerSourceSchema,
    providerTagCidr: z.string().nullable(),
    providerTagSource: z.string().nullable(),
    providerConfidence: finiteNumber.nullable(),
    providerEvidenceUrl: z.string().nullable(),
    asn: nullableInteger,
    asnOrg: z.string().nullable(),
  })
  // The full unversioned payload includes additional legacy fields. Keep them
  // available while making the fields used by the UI explicit and testable.
  .passthrough();

export const masternodeAnalyticsSchema = z.object({
  activeOverTime: z.array(
    z.object({
      date: z.string(),
      timestamp: finiteNumber,
      active: integer.nonnegative(),
      newCount: integer.nonnegative(),
      removedCount: integer.nonnegative(),
    })
  ),
  newVsRemoved: z.object({
    daily: z.array(
      z.object({
        date: z.string(),
        timestamp: finiteNumber,
        active: integer.nonnegative(),
        newCount: integer.nonnegative(),
        removedCount: integer.nonnegative(),
      })
    ),
    weekly: z.array(
      z.object({
        label: z.string(),
        newCount: integer.nonnegative(),
        removedCount: integer.nonnegative(),
      })
    ),
  }),
});

export const masternodePayloadSchema = masternodeSnapshotMetaSchema.extend({
  total: integer.nonnegative(),
  countries: z.array(masternodeCountrySchema),
  providers: z.array(masternodeProviderSchema),
  nodes: z.array(masternodeNodeSchema),
  analytics: masternodeAnalyticsSchema,
});

export const masternodeSummarySchema = masternodeSnapshotMetaSchema.extend({
  total: integer.nonnegative(),
  enabled: integer.nonnegative(),
  poseBanned: integer.nonnegative(),
  posePenalty: integer.nonnegative(),
  countries: integer.nonnegative(),
  tagged: integer.nonnegative(),
  taggedCoveragePct: finiteNumber,
  enabledPct: finiteNumber,
  topCountry: masternodeCountrySchema.nullable(),
  topProvider: masternodeProviderSchema.nullable(),
});

export const masternodeDistributionSchema = masternodeSnapshotMetaSchema.extend({
  total: integer.nonnegative(),
  countries: z.array(masternodeCountrySchema),
  providers: z.array(masternodeProviderSchema),
});

export const masternodeListItemSchema = masternodeNodeSchema.pick({
  id: true,
  service: true,
  ip: true,
  port: true,
  status: true,
  lastSeen: true,
  countryCode: true,
  countryName: true,
  provider: true,
  providerSource: true,
  providerTagCidr: true,
  providerTagSource: true,
  providerConfidence: true,
  providerEvidenceUrl: true,
  asn: true,
  asnOrg: true,
});

export const masternodeNodesSchema = masternodeSnapshotMetaSchema.extend({
  total: integer.nonnegative(),
  filteredTotal: integer.nonnegative(),
  page: integer.positive(),
  pageSize: integer.positive(),
  pages: integer.positive(),
  sourceCounts: z.object({
    all: integer.nonnegative(),
    tagged: integer.nonnegative(),
    auto: integer.nonnegative(),
  }),
  nodes: z.array(masternodeListItemSchema),
});

export const masternodeApiResponseSchema = apiSuccessSchema(masternodePayloadSchema);
export const masternodeSummaryApiResponseSchema = apiSuccessSchema(masternodeSummarySchema);
export const masternodeDistributionApiResponseSchema = apiSuccessSchema(masternodeDistributionSchema);
export const masternodeNodesApiResponseSchema = apiSuccessSchema(masternodeNodesSchema);

export type MasternodeCountryContract = z.infer<typeof masternodeCountrySchema>;
export type MasternodeProviderContract = z.infer<typeof masternodeProviderSchema>;
export type MasternodeNodeContract = z.infer<typeof masternodeNodeSchema>;
export type MasternodeAnalyticsContract = z.infer<typeof masternodeAnalyticsSchema>;
export type MasternodePayloadContract = z.infer<typeof masternodePayloadSchema>;
export type MasternodeSummaryContract = z.infer<typeof masternodeSummarySchema>;
export type MasternodeDistributionContract = z.infer<typeof masternodeDistributionSchema>;
export type MasternodeListItemContract = z.infer<typeof masternodeListItemSchema>;
export type MasternodeNodesContract = z.infer<typeof masternodeNodesSchema>;
export type MasternodeApiResponse = z.infer<typeof masternodeApiResponseSchema>;
export type MasternodeSummaryApiResponse = z.infer<typeof masternodeSummaryApiResponseSchema>;
export type MasternodeDistributionApiResponse = z.infer<typeof masternodeDistributionApiResponseSchema>;
export type MasternodeNodesApiResponse = z.infer<typeof masternodeNodesApiResponseSchema>;

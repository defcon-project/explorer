import {
  masternodeApiResponseSchema,
  masternodeNodesApiResponseSchema,
  masternodeSummaryApiResponseSchema,
  nodeInventoryApiResponseSchema,
  networkNoiseSummaryApiResponseSchema,
  searchApiResponseSchema,
  statsApiResponseSchema,
} from '@defcon/shared/dist/contracts';

const statsPayload = {
  success: true,
  data: {
    blockHeight: 130_000,
    lastBlockTime: 1_726_000_000,
    difficulty: 1.25,
    hashrate: 42,
    connections: 8,
    mempool: { size: 2, bytes: 384 },
    supply: { circulating: 1_000_000, max: null },
    blockReward: 5,
    stakingReward: 1,
    avgBlockTime: 150,
    txCount24h: 32,
    totalValueTransferred24h: 280.5,
    txCount30d: 1_024,
    avgTxPerBlock30d: 1.2,
    txTrend30d: [{ date: '2026-09-05', count: 32 }],
    flow24h: [{ hour: '2026-09-05T12:00:00Z', blocks: 2, txs: 3 }],
    newAddresses24h: 4,
    newAddresses7d: 18,
    totalTransactions: 9_999,
    totalAddresses: 1_024,
    masternodes: 160,
    stakingWallets: 82,
  },
};

const masternodeNode = {
  id: 'mn-1',
  service: '203.0.113.10:8192',
  ip: '203.0.113.10',
  port: 8192,
  status: 'ENABLED',
  protocol: 70242,
  lastSeen: 1_726_000_000,
  activeSeconds: 86_400,
  isTor: false,
  countryCode: 'HU',
  countryName: 'Hungary',
  proTxHash: 'a'.repeat(64),
  ownerAddress: null,
  payoutAddress: null,
  collateralAddress: null,
  registeredHeight: 129_000,
  registeredAt: 1_725_000_000,
  poseBanHeight: null,
  poseBanAt: null,
  collateralAmount: 1_000_000,
  provider: 'Example Host',
  providerSource: 'tag' as const,
  providerTagCidr: '203.0.113.0/24',
  providerTagSource: 'manual',
  providerConfidence: 1,
  providerEvidenceUrl: null,
  asn: 64_500,
  asnOrg: 'Example Host',
};

const masternodeSnapshotMeta = {
  snapshotId: 'mn-lz0abc-1',
  observedAt: '2026-09-05T12:00:00.000Z',
};

describe('shared API contracts', () => {
  it('accepts the documented stats response shape', () => {
    expect(statsApiResponseSchema.parse(statsPayload)).toEqual(statsPayload);
  });

  it('rejects invalid stats counters before a response can be sent', () => {
    expect(
      statsApiResponseSchema.safeParse({
        ...statsPayload,
        data: { ...statsPayload.data, connections: -1 },
      }).success
    ).toBe(false);
  });

  it('accepts documented search variants while retaining legacy result fields', () => {
    const payload = {
      success: true,
      data: {
        type: 'block' as const,
        matchedBy: 'height' as const,
        result: { height: 123, hash: 'a'.repeat(64), _id: 'legacy-id' },
      },
    };

    expect(searchApiResponseSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a search result whose match method does not match its type', () => {
    expect(
      searchApiResponseSchema.safeParse({
        success: true,
        data: {
          type: 'transaction',
          matchedBy: 'hash',
          result: { txid: 'b'.repeat(64) },
        },
      }).success
    ).toBe(false);
  });

  it('accepts the full masternode snapshot while retaining unversioned legacy fields', () => {
    const payload = {
      success: true,
      data: {
        ...masternodeSnapshotMeta,
        total: 1,
        countries: [{ countryCode: 'HU', countryName: 'Hungary', count: 1 }],
        providers: [{ provider: 'Example Host', count: 1 }],
        nodes: [{ ...masternodeNode, posePenalty: 0, poseRevivedHeight: null }],
        analytics: {
          activeOverTime: [],
          newVsRemoved: { daily: [], weekly: [] },
        },
      },
    };

    expect(masternodeApiResponseSchema.parse(payload)).toEqual(payload);
  });

  it('accepts the documented masternode summary and rejects an invalid node page', () => {
    expect(
      masternodeSummaryApiResponseSchema.safeParse({
        success: true,
        data: {
          ...masternodeSnapshotMeta,
          total: 1,
          enabled: 1,
          poseBanned: 0,
          posePenalty: 0,
          countries: 1,
          tagged: 1,
          taggedCoveragePct: 100,
          enabledPct: 100,
          topCountry: { countryCode: 'HU', countryName: 'Hungary', count: 1 },
          topProvider: { provider: 'Example Host', count: 1, tagged: 1, auto: 0 },
        },
      }).success
    ).toBe(true);

    expect(
      masternodeNodesApiResponseSchema.safeParse({
        success: true,
        data: {
          ...masternodeSnapshotMeta,
          total: 1,
          filteredTotal: 1,
          page: 0,
          pageSize: 100,
          pages: 1,
          sourceCounts: { all: 1, tagged: 1, auto: 0 },
          nodes: [masternodeNode],
        },
      }).success
    ).toBe(false);
  });

  it('accepts Node Inventory and Network Noise monitor response shapes', () => {
    expect(
      nodeInventoryApiResponseSchema.safeParse({
        success: true,
        data: {
          generatedAt: '2026-09-05T12:00:00.000Z',
          requiredVersion: '23.0.0',
          staleAfterSeconds: 900,
          summary: {
            observed: 1,
            knownVersion: 1,
            recommended: 1,
            deprecated: 0,
            mainChain: 1,
            chainRisk: 0,
            stale: 0,
          },
          versions: [{ version: '23.0.0', count: 1 }],
          total: 1,
          nodes: [
            {
              nodeKey: '203.0.113.10:8192',
              ip: '203.0.113.10',
              port: 8192,
              sources: ['direct_peer'],
              labels: [],
              walletVersion: '23.0.0',
              protocolVersion: 70242,
              blockHeight: 130_000,
              bestBlockHash: 'a'.repeat(64),
              connections: 8,
              syncProgress: 1,
              nodeStatus: 'connected',
              chainStatus: 'main_chain',
              blocksDelta: 0,
              masternodeProTxHash: null,
              masternodeStatus: null,
              firstSeenAt: '2026-09-05T11:00:00.000Z',
              lastSeenAt: '2026-09-05T12:00:00.000Z',
              lastObservedAt: '2026-09-05T12:00:00.000Z',
              isDeprecated: false,
              isStale: false,
            },
          ],
        },
      }).success
    ).toBe(true);

    expect(
      networkNoiseSummaryApiResponseSchema.safeParse({
        success: true,
        data: {
          generatedAt: '2026-09-05T12:00:00.000Z',
          windowHours: 24,
          staleAfterSeconds: 300,
          summary: {
            currentScore: 0,
            currentLevel: 'quiet',
            knownNodes: 0,
            reportingNodes: 0,
            staleNodes: 0,
            activeSignals: 0,
            chainAlerts: 0,
          },
          nodes: [],
          timeline: [],
          recentSignals: [],
        },
      }).success
    ).toBe(true);
  });
});

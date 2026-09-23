import {
  buildBanWaves,
  classifyHistoricalBanEvents,
  isActiveMasternodeStatus,
  isConfirmedBanTransition,
  type HistoricalBanEvent,
} from '../src/domain/pose/banAnalytics';

function event(overrides: Partial<HistoricalBanEvent> = {}): HistoricalBanEvent {
  return {
    nodeId: 'node-a',
    service: '10.0.0.1:8192',
    previousStatus: 'ENABLED',
    currentStatus: 'POSE_BANNED',
    at: Date.now(),
    dedupeId: 'protx-a',
    proTxHash: 'protx-a',
    ip: '10.0.0.1',
    countryCode: 'DE',
    countryName: 'Germany',
    operatorPubkey: 'operator-a',
    payoutAddress: 'Dabc',
    provider: 'Contabo',
    providerSource: 'auto',
    providerTagCidr: null,
    providerTagSource: null,
    providerConfidence: 90,
    asn: 1,
    asnOrg: 'Example ASN',
    poseBanHeight: 100,
    detectedHeight: 100,
    recoveredAt: null,
    recoveredHeight: null,
    recoveryTransition: null,
    eventStatus: 'banned',
    ...overrides,
  };
}

describe('PoSe ban analytics domain', () => {
  it('treats ENABLED and POSE_PENALTY as active masternode states', () => {
    expect(isActiveMasternodeStatus('ENABLED')).toBe(true);
    expect(isActiveMasternodeStatus('pose_penalty')).toBe(true);
    expect(isActiveMasternodeStatus('POSE_BANNED')).toBe(false);
    expect(isActiveMasternodeStatus(null)).toBe(false);
  });

  it('accepts real ban transitions and rejects snapshot-only observations', () => {
    expect(isConfirmedBanTransition(event({ previousStatus: 'ENABLED' }))).toBe(true);
    expect(isConfirmedBanTransition(event({ previousStatus: 'POSE_PENALTY' }))).toBe(true);
    expect(
      isConfirmedBanTransition(
        event({ previousStatus: 'POSE_BAN_HEIGHT', poseBanHeight: 123 })
      )
    ).toBe(true);

    expect(isConfirmedBanTransition(event({ previousStatus: 'NEW' }))).toBe(false);
    expect(isConfirmedBanTransition(event({ previousStatus: 'UNKNOWN' }))).toBe(false);
    expect(isConfirmedBanTransition(event({ previousStatus: 'POSE_BANNED' }))).toBe(false);
    expect(
      isConfirmedBanTransition(
        event({ previousStatus: 'POSE_BAN_HEIGHT', poseBanHeight: null })
      )
    ).toBe(false);
  });

  it('deduplicates fresh drops by stable identity but retains the event count', () => {
    const now = Date.now();
    const events = [
      event({ at: now - 1_000 }),
      event({ at: now - 500, nodeId: 'node-a-repeated', dedupeId: 'protx-a' }),
      event({
        at: now - 2_000,
        nodeId: 'node-b',
        dedupeId: 'protx-b',
        proTxHash: 'protx-b',
        previousStatus: 'POSE_PENALTY',
      }),
      event({
        at: now - 3_000,
        nodeId: 'node-c',
        dedupeId: 'protx-c',
        proTxHash: 'protx-c',
        previousStatus: 'UNKNOWN',
      }),
    ];

    const result = classifyHistoricalBanEvents(events, {
      freshSinceMs: now - 60_000,
      windowSinceMs: now - 60_000,
    });

    expect(result.freshDrops24h).toBe(2);
    expect(result.freshDropEvents24h).toBe(3);
    expect(result.observedAlreadyBanned24hEvents).toHaveLength(1);
  });

  it('keeps recovered nodes in historical waves and respects the time boundary', () => {
    const start = Date.now() - 10_000;
    const events = [
      event({ at: start }),
      event({
        at: start + 30_000,
        nodeId: 'node-b',
        dedupeId: 'protx-b',
        proTxHash: 'protx-b',
        ip: '10.0.0.2',
        eventStatus: 'recovered',
        recoveredAt: start + 40_000,
      }),
      event({
        at: start + 60_001,
        nodeId: 'node-c',
        dedupeId: 'protx-c',
        proTxHash: 'protx-c',
        ip: '10.0.0.3',
      }),
    ];

    const waves = buildBanWaves(events, {
      windowSeconds: 60,
      minNodes: 2,
      toWaveNode: (row) => ({
        ip: row.ip,
        operatorPubkey: row.operatorPubkey,
        countryCode: row.countryCode,
        provider: row.provider,
        walletVersion: '22.1.4',
        protocolVersion: 70238,
        status: row.eventStatus === 'recovered' ? 'recovered' : 'still_banned',
      }),
    });

    expect(waves).toHaveLength(1);
    expect(waves[0]).toEqual(
      expect.objectContaining({
        totalNodes: 2,
        recoveredCount: 1,
        stillBannedCount: 1,
      })
    );
  });
});

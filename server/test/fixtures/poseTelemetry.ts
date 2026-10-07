import type { NetworkNoiseIngestPayload, PoseTelemetryEvent } from '@defcon/shared/dist/contracts';

export function poseEvent(overrides: Partial<PoseTelemetryEvent> = {}): PoseTelemetryEvent {
  return {
    eventId: 'log-offset-101',
    kind: 'penalty_change',
    eventAt: '2026-10-06T12:01:00Z',
    eventBlockHeight: 147909,
    eventBlockHash: 'a'.repeat(64),
    quorumType: 2,
    quorumHash: 'b'.repeat(64),
    proTxHash: 'c'.repeat(64),
    previousPenalty: 0,
    penalty: 145,
    poseBanHeight: null,
    memberValid: null,
    sample: 'redacted PoSe penalty 0 -> 145',
    ...overrides,
  };
}

export function posePayload(overrides: Partial<Extract<NetworkNoiseIngestPayload, { schemaVersion: 2 }>> = {}) {
  return {
    schemaVersion: 2 as const,
    agentVersion: '2.0.0',
    nodeId: 'node-a',
    nodeRole: 'fullnode' as const,
    observedAt: '2026-10-06T12:03:00Z',
    sequence: 12,
    snapshot: { ip: '198.51.100.40', blockHeight: 147912, bestBlockHash: 'd'.repeat(64) },
    signals: [],
    poseEvents: [poseEvent()],
    ...overrides,
  };
}

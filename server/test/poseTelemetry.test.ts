import { describe, expect, it } from 'vitest';
import { networkNoiseIngestSchema, poseTelemetryEventSchema } from '@defcon/shared/dist/contracts';
import { isDuplicateKeyOnly, poseObservationIdentity } from '../src/domain/pose/poseTelemetry';
import { poseEvent, posePayload } from './fixtures/poseTelemetry';

describe('structured PoSe identity and ingest contract', () => {
  it('retains every structured field and normalizes hash casing', () => {
    const parsed = networkNoiseIngestSchema.parse(posePayload({
      poseEvents: [poseEvent({ eventBlockHash: 'A'.repeat(64) })],
    }));
    expect(parsed.schemaVersion).toBe(2);
    if (parsed.schemaVersion !== 2) throw new Error('Wrong version');
    expect(parsed.poseEvents[0]).toEqual(poseEvent());
  });

  it('preserves legacy batches and does not infer structured events from samples', () => {
    const parsed = networkNoiseIngestSchema.parse({ ...posePayload(), schemaVersion: 1 });
    expect(parsed).not.toHaveProperty('poseEvents');
  });

  it('requires explicit event anchors, allowing null without snapshot substitution', () => {
    const payload = posePayload({ poseEvents: [poseEvent({ eventBlockHeight: null, eventBlockHash: null })] });
    expect(networkNoiseIngestSchema.safeParse(payload).success).toBe(true);
    const { eventBlockHeight: _removed, ...missing } = payload.poseEvents[0];
    expect(poseTelemetryEventSchema.safeParse(missing).success).toBe(false);
    expect(poseObservationIdentity('node-a', payload.poseEvents[0]).identityComplete).toBe(false);
  });

  it.each([
    { proTxHash: 'bad-hash' },
    { quorumType: 256 },
    { penalty: -1 },
    { previousPenalty: null },
    { sample: 'x'.repeat(301) },
    { kind: 'ban' as const, poseBanHeight: 0 },
    { kind: 'dkg_member' as const, memberValid: null },
    { memberValid: false },
  ])('rejects malformed or incomplete kind-specific data: %j', (overrides) => {
    expect(poseTelemetryEventSchema.safeParse(poseEvent(overrides)).success).toBe(false);
  });

  it('accepts DKG validity as observed data and never grants claimed chain evidence', () => {
    const parsed = poseTelemetryEventSchema.parse({
      ...poseEvent({ kind: 'dkg_member', memberValid: false, previousPenalty: null, penalty: null }),
      evidence: 'chain_verified', canonicalStatus: 'canonical',
    });
    expect(parsed).not.toHaveProperty('evidence');
    expect(parsed).not.toHaveProperty('canonicalStatus');
  });

  it('limits batches and requires stable distinct source event IDs', () => {
    expect(networkNoiseIngestSchema.safeParse(posePayload({ poseEvents: [poseEvent(), poseEvent()] })).success).toBe(false);
    expect(networkNoiseIngestSchema.safeParse(posePayload({
      poseEvents: Array.from({ length: 101 }, (_, i) => poseEvent({ eventId: `log-offset-${i}` })),
    })).success).toBe(false);
  });

  it('deduplicates complete events across retries and counts observers separately', () => {
    const first = poseObservationIdentity('node-a', poseEvent());
    const retry = poseObservationIdentity('node-a', poseEvent({ eventId: 'another-log-id', eventAt: '2026-10-06T12:02:00Z' }));
    const other = poseObservationIdentity('seed-b', poseEvent());
    expect(retry).toEqual(first);
    expect(other.eventKey).toBe(first.eventKey);
    expect(other.observationKey).not.toBe(first.observationKey);
  });

  it('keeps conflicting scores as evidence variants within the same event', () => {
    const first = poseObservationIdentity('node-a', poseEvent());
    const conflict = poseObservationIdentity('node-a', poseEvent({ penalty: 146 }));
    expect(conflict.eventKey).toBe(first.eventKey);
    expect(conflict.observationKey).not.toBe(first.observationKey);
  });

  it.each([
    { eventBlockHash: 'e'.repeat(64) },
    { eventBlockHeight: 147910 },
    { quorumType: 7 },
    { quorumHash: 'e'.repeat(64) },
    { proTxHash: 'e'.repeat(64) },
    { kind: 'ban' as const, poseBanHeight: 147909 },
  ])('keeps forks, quorum types, members and event kinds separate: %j', (overrides) => {
    expect(poseObservationIdentity('node-a', poseEvent(overrides)).eventKey)
      .not.toBe(poseObservationIdentity('node-a', poseEvent()).eventKey);
  });

  it('never correlates incomplete anchors or quorum build failures across reporters', () => {
    for (const event of [poseEvent({ quorumHash: null }), poseEvent({ kind: 'quorum_build_failure' })]) {
      const first = poseObservationIdentity('node-a', event);
      expect(first.identityComplete).toBe(false);
      expect(poseObservationIdentity('node-b', event).eventKey).not.toBe(first.eventKey);
    }
  });

  it('suppresses only duplicate-key errors, including unordered batch errors', () => {
    expect(isDuplicateKeyOnly({ code: 11000 })).toBe(true);
    expect(isDuplicateKeyOnly({ code: 11000, writeErrors: [{ code: 11000 }, { code: 121 }] })).toBe(false);
    expect(isDuplicateKeyOnly({ code: 11000, writeConcernErrors: [{}] })).toBe(false);
    expect(isDuplicateKeyOnly({ code: 11000, result: { getWriteConcernError: () => ({ code: 64 }) } })).toBe(false);
    expect(isDuplicateKeyOnly(new Error('network unavailable'))).toBe(false);
  });
});

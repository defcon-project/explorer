import crypto from 'node:crypto';
import type { PoseTelemetryEvent } from '@defcon/shared/dist/contracts';

function digest(parts: unknown[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function poseObservationIdentity(nodeId: string, event: PoseTelemetryEvent) {
  // Missing fields remain missing: snapshot.blockHeight is never an event height.
  const identityComplete = event.eventBlockHeight !== null && event.eventBlockHash !== null
    && event.quorumType !== null && event.quorumHash !== null && event.proTxHash !== null
    && event.kind !== 'quorum_build_failure';
  const eventKey = identityComplete
    ? digest(['pose-event-v1', event.eventBlockHeight, event.eventBlockHash, event.quorumType,
      event.quorumHash, event.proTxHash, event.kind])
    : digest(['pose-unlinked-v1', nodeId, event.eventId]);
  // Preserve conflicting reports without counting them as different events or observers.
  const observationKey = identityComplete
    ? digest([eventKey, nodeId, event.previousPenalty, event.penalty, event.poseBanHeight, event.memberValid])
    : digest([eventKey, nodeId]);
  return { eventKey, observationKey, identityComplete };
}

/** Unordered bulk writes may contain several failures. Never hide a mixed failure. */
export function isDuplicateKeyOnly(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const bulk = error as {
    code?: number;
    writeErrors?: { code: number }[];
    writeConcernErrors?: unknown[];
    result?: { getWriteConcernError?: () => unknown };
  };
  if (bulk.writeConcernErrors?.length || bulk.result?.getWriteConcernError?.()) return false;
  if (bulk.writeErrors?.length) return bulk.writeErrors.every((entry) => entry.code === 11000);
  return bulk.code === 11000;
}

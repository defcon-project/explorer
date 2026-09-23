import type { WsSyncStatusPayload } from '../../types/realtime';

export interface StoredSyncCursor {
  lastSyncedHeight?: number | null;
  lastSyncedHash?: string | null;
  isRunning?: boolean | null;
  addressRebuildRequired?: boolean | null;
}

export interface IndexedTip {
  height: number;
  hash: string;
}

export interface StartupRecoveryPlan {
  initializeCursor: IndexedTip | null;
  correctCursor: IndexedTip | null;
  resetStaleLock: boolean;
  rebuildAddressIndex: boolean;
}

export interface CatchUpPlan {
  upToDate: boolean;
  startHeight: number;
  endHeight: number;
  blocksToSync: number;
}

export function syncProgressPercent(lastSyncedHeight: number, daemonHeight: number): number {
  if (daemonHeight < 0) return 0;
  if (daemonHeight === 0) return lastSyncedHeight >= 0 ? 100 : 0;

  const raw = ((lastSyncedHeight + 1) / (daemonHeight + 1)) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
}

export function buildSyncStatusPayload(
  state: WsSyncStatusPayload['state'],
  daemonHeight: number,
  lastSyncedHeight: number,
  options?: { message?: string; error?: string | null }
): WsSyncStatusPayload {
  const effectiveDaemonHeight = Math.max(-1, daemonHeight);
  return {
    state,
    daemonHeight: effectiveDaemonHeight,
    lastSyncedHeight,
    blocksRemaining:
      effectiveDaemonHeight >= 0 ? Math.max(0, effectiveDaemonHeight - lastSyncedHeight) : 0,
    progress: syncProgressPercent(lastSyncedHeight, effectiveDaemonHeight),
    message: options?.message,
    error: options?.error ?? null,
  };
}

export function planStartupRecovery(
  state: StoredSyncCursor | null,
  indexedTip: IndexedTip | null
): StartupRecoveryPlan {
  const actualTip = indexedTip ?? { height: -1, hash: '' };
  if (!state) {
    return {
      initializeCursor: actualTip,
      correctCursor: null,
      resetStaleLock: false,
      rebuildAddressIndex: false,
    };
  }

  const storedHeight = state.lastSyncedHeight ?? -1;
  const storedHash = state.lastSyncedHash ?? '';
  const cursorAhead = storedHeight > actualTip.height;
  const sameHeightHashMismatch =
    storedHeight === actualTip.height && storedHeight >= 0 && storedHash !== actualTip.hash;
  const correctCursor = cursorAhead || sameHeightHashMismatch ? actualTip : null;
  const resetStaleLock = state.isRunning === true;

  return {
    initializeCursor: null,
    correctCursor,
    resetStaleLock,
    rebuildAddressIndex:
      state.addressRebuildRequired === true || correctCursor !== null || resetStaleLock,
  };
}

export function planCatchUp(lastSyncedHeight: number, daemonHeight: number): CatchUpPlan {
  const upToDate = lastSyncedHeight >= daemonHeight;
  return {
    upToDate,
    startHeight: upToDate ? daemonHeight + 1 : lastSyncedHeight + 1,
    endHeight: daemonHeight,
    blocksToSync: upToDate ? 0 : Math.max(0, daemonHeight - lastSyncedHeight),
  };
}

export function shouldPersistSyncCheckpoint(input: {
  currentHeight: number;
  syncStartHeight: number;
  daemonHeight: number;
  nowMs: number;
  lastCheckpointAtMs: number;
  blockInterval: number;
  maxIntervalMs: number;
}): boolean {
  const syncedBlocks = input.currentHeight - input.syncStartHeight;
  return (
    syncedBlocks % input.blockInterval === 0 ||
    input.nowMs - input.lastCheckpointAtMs >= input.maxIntervalMs ||
    input.currentHeight === input.daemonHeight
  );
}

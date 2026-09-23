export type PublicSyncErrorCode = 'SYNC_FAILED' | 'RPC_UNAVAILABLE' | null;

/**
 * Map the stored sync error (a raw internal error message that can contain
 * RPC or MongoDB host details) to a fixed public message. Every public output
 * (REST, SPA boot data, WebSocket) must use this instead of the raw value.
 */
export function mapPublicSyncError(
  syncError: unknown,
  rpcConnected: boolean
): { error: string | null; errorCode: PublicSyncErrorCode } {
  if (!syncError) {
    return { error: null, errorCode: null };
  }

  if (!rpcConnected) {
    return {
      error: 'Sync degraded: daemon RPC is unavailable. Check server logs.',
      errorCode: 'RPC_UNAVAILABLE',
    };
  }

  return {
    error: 'Sync failed. Check server logs.',
    errorCode: 'SYNC_FAILED',
  };
}

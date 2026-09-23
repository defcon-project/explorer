export type RealtimeServerEventType =
  | 'hello'
  | 'pong'
  | 'sync:status'
  | 'block:new'
  | 'tx:new'
  | 'error';

export interface RealtimeEnvelope<TType extends string, TData> {
  type: TType;
  ts: string;
  seq?: number;
  data: TData;
}

export interface WsHelloPayload {
  connectionId: string;
  protocolVersion: number;
  heartbeatIntervalMs: number;
}

export interface WsPongPayload {
  clientTs?: string;
}

export interface WsSyncStatusPayload {
  state: 'started' | 'syncing' | 'idle' | 'complete' | 'error';
  daemonHeight: number;
  lastSyncedHeight: number;
  blocksRemaining: number;
  progress: number;
  message?: string;
  error?: string | null;
}

export interface WsBlockNewPayload {
  hash: string;
  height: number;
  time: number;
  txCount: number;
  minedBy?: string;
}

export interface WsTxNewPayload {
  txid: string;
  blockHash: string;
  blockHeight: number;
  blockTime: number;
  index: number;
}

export interface WsErrorPayload {
  code: string;
  message: string;
}

export type RealtimeServerEvent =
  | RealtimeEnvelope<'hello', WsHelloPayload>
  | RealtimeEnvelope<'pong', WsPongPayload>
  | RealtimeEnvelope<'sync:status', WsSyncStatusPayload>
  | RealtimeEnvelope<'block:new', WsBlockNewPayload>
  | RealtimeEnvelope<'tx:new', WsTxNewPayload>
  | RealtimeEnvelope<'error', WsErrorPayload>;

import type { BanWaveNodeBase, HistoricalBanEvent } from './banAnalytics';

export interface LiveBanNodeSnapshot {
  id: string;
  status: string;
  service?: string;
  proTxHash?: string | null;
  ip?: string;
  countryCode?: string;
  countryName?: string;
  operatorPubkey?: string | null;
  payoutAddress?: string | null;
  provider?: string | null;
  providerSource?: string | null;
  providerTagCidr?: string | null;
  providerTagSource?: string | null;
  providerConfidence?: number | null;
  asn?: number | null;
  asnOrg?: string | null;
}

export interface VersionInventorySnapshot {
  walletVersion: string | null;
  protocolVersion: number | null;
  lastObservedAt: Date | null;
}

export type BanWavePresentationNode = BanWaveNodeBase & {
  nodeId: string;
  service: string;
  previousStatus: string;
  proTxHash: string | null;
  countryName: string;
  payoutAddress: string | null;
  atIso: string;
  detectedAt: string;
  recoveredAt: string | null;
  recoveredHeight: number | null;
  recoveryTransition: string | null;
  poseBanHeight: number | null;
  detectedHeight: number | null;
  providerSource: string | null;
  providerTagCidr: string | null;
  providerTagSource: string | null;
  providerConfidence: number | null;
  asn: number | null;
  asnOrg: string | null;
  versionObservedAt: string | null;
};

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function mapStoredBanEvent(
  raw: Record<string, unknown>,
  live?: LiveBanNodeSnapshot
): HistoricalBanEvent {
  const nodeId = String(raw.nodeId || '');
  const storedProTxHash = optionalText(raw.proTxHash);
  const recoveredAt = raw.recoveredAt ? new Date(raw.recoveredAt as Date).getTime() : null;
  const liveRecovered = live ? live.status !== 'POSE_BANNED' : false;

  return {
    nodeId,
    service: String(raw.service || live?.service || ''),
    previousStatus: String(raw.previousStatus || 'POSE_BAN_HEIGHT'),
    currentStatus: optionalText(raw.currentStatus) || 'POSE_BANNED',
    at: new Date(raw.detectedAt as Date).getTime(),
    dedupeId: storedProTxHash || nodeId,
    proTxHash: storedProTxHash || live?.proTxHash || null,
    ip: String(raw.ip || live?.ip || ''),
    countryCode: String(raw.countryCode || live?.countryCode || 'UNK'),
    countryName: String(raw.countryName || live?.countryName || 'Unknown'),
    operatorPubkey: optionalText(raw.operatorPubkey) || live?.operatorPubkey || null,
    payoutAddress: optionalText(raw.payoutAddress) || live?.payoutAddress || null,
    provider: optionalText(raw.provider) || live?.provider || null,
    providerSource: optionalText(raw.providerSource) || live?.providerSource || null,
    providerTagCidr: optionalText(raw.providerTagCidr) || live?.providerTagCidr || null,
    providerTagSource: optionalText(raw.providerTagSource) || live?.providerTagSource || null,
    providerConfidence:
      optionalNumber(raw.providerConfidence) ?? live?.providerConfidence ?? null,
    asn: optionalNumber(raw.asn) ?? live?.asn ?? null,
    asnOrg: optionalText(raw.asnOrg) || live?.asnOrg || null,
    poseBanHeight: optionalNumber(raw.poseBanHeight),
    detectedHeight: optionalNumber(raw.detectedHeight),
    recoveredAt,
    recoveredHeight: optionalNumber(raw.recoveredHeight),
    recoveryTransition: optionalText(raw.recoveryTransition),
    eventStatus:
      recoveredAt || liveRecovered || raw.eventStatus === 'recovered' ? 'recovered' : 'banned',
  };
}

export function mapBanWaveNode(
  event: HistoricalBanEvent,
  live?: LiveBanNodeSnapshot,
  inventory?: VersionInventorySnapshot
): BanWavePresentationNode {
  const ip = event.ip || live?.ip || '';
  const detectedAt = new Date(event.at).toISOString();
  const recovered = event.eventStatus === 'recovered' || (live && live.status !== 'POSE_BANNED');

  return {
    nodeId: event.nodeId,
    service: event.service || live?.service || '',
    previousStatus: event.previousStatus,
    proTxHash: event.proTxHash || live?.proTxHash || null,
    countryCode: event.countryCode || live?.countryCode || 'UNK',
    countryName: event.countryName || live?.countryName || 'Unknown',
    ip,
    operatorPubkey: event.operatorPubkey || live?.operatorPubkey || null,
    payoutAddress: event.payoutAddress || live?.payoutAddress || null,
    atIso: detectedAt,
    detectedAt,
    recoveredAt: event.recoveredAt ? new Date(event.recoveredAt).toISOString() : null,
    recoveredHeight: event.recoveredHeight,
    recoveryTransition: event.recoveryTransition,
    status: recovered ? 'recovered' : 'still_banned',
    poseBanHeight: event.poseBanHeight,
    detectedHeight: event.detectedHeight,
    provider: event.provider || live?.provider || null,
    providerSource: event.providerSource || live?.providerSource || null,
    providerTagCidr: event.providerTagCidr || live?.providerTagCidr || null,
    providerTagSource: event.providerTagSource || live?.providerTagSource || null,
    providerConfidence: event.providerConfidence ?? live?.providerConfidence ?? null,
    asn: event.asn ?? live?.asn ?? null,
    asnOrg: event.asnOrg || live?.asnOrg || null,
    walletVersion: inventory?.walletVersion ?? null,
    protocolVersion: inventory?.protocolVersion ?? null,
    versionObservedAt: inventory?.lastObservedAt
      ? new Date(inventory.lastObservedAt).toISOString()
      : null,
  };
}

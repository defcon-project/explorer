export type HistoricalBanStatus = 'banned' | 'recovered';

export interface HistoricalBanEvent {
  nodeId: string;
  service: string;
  previousStatus: string;
  currentStatus?: string | null;
  at: number;
  dedupeId: string;
  proTxHash: string | null;
  ip: string;
  countryCode: string;
  countryName: string;
  operatorPubkey: string | null;
  payoutAddress: string | null;
  provider: string | null;
  providerSource: string | null;
  providerTagCidr: string | null;
  providerTagSource: string | null;
  providerConfidence: number | null;
  asn: number | null;
  asnOrg: string | null;
  poseBanHeight: number | null;
  detectedHeight: number | null;
  recoveredAt: number | null;
  recoveredHeight: number | null;
  recoveryTransition: string | null;
  eventStatus: HistoricalBanStatus;
}

export type BanWaveSeverity = 'low' | 'moderate' | 'high' | 'critical';

export interface BanWaveNodeBase {
  ip: string;
  operatorPubkey: string | null;
  countryCode: string;
  provider: string | null;
  walletVersion: string | null;
  protocolVersion: number | null;
  status: 'banned' | 'recovered' | 'still_banned';
}

export interface BanWave<TNode extends BanWaveNodeBase> {
  id: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  windowSeconds: number;
  totalNodes: number;
  bannedCount: number;
  recoveredCount: number;
  stillBannedCount: number;
  uniqueIps: number;
  uniqueOperators: number;
  uniqueCountries: number;
  countries: string[];
  providers: string[];
  versions: string[];
  severity: BanWaveSeverity;
  severityScore: number;
  nodes: TNode[];
}

function normalizedStatus(value: string | null | undefined): string {
  return String(value || '').trim().toUpperCase();
}

export function isActiveMasternodeStatus(status: string | null | undefined): boolean {
  const normalized = normalizedStatus(status);
  return normalized === 'ENABLED' || normalized === 'POSE_PENALTY';
}

export function banEventIdentity(event: Pick<HistoricalBanEvent, 'dedupeId' | 'nodeId'>): string {
  return event.dedupeId || event.nodeId;
}

/**
 * A fresh drop must be a real transition or carry an on-chain PoSeBanHeight.
 * Snapshot-only NEW/UNKNOWN/already-banned observations are intentionally excluded.
 */
export function isConfirmedBanTransition(
  event: Pick<HistoricalBanEvent, 'previousStatus' | 'currentStatus' | 'poseBanHeight'>
): boolean {
  const previous = normalizedStatus(event.previousStatus);
  const current = normalizedStatus(event.currentStatus);

  if (previous === 'POSE_BAN_HEIGHT') {
    return typeof event.poseBanHeight === 'number' && event.poseBanHeight > 0;
  }

  const enteredBan = current === '' || current === 'POSE_BANNED';
  return enteredBan && (previous === 'ENABLED' || previous === 'POSE_PENALTY');
}

export function classifyHistoricalBanEvents(
  events: HistoricalBanEvent[],
  options: { freshSinceMs: number; windowSinceMs: number }
) {
  const confirmed = events.filter(isConfirmedBanTransition);
  const observedAlreadyBannedEvents = events.filter((event) => !isConfirmedBanTransition(event));
  const freshBanEvents = confirmed.filter((event) => event.at >= options.freshSinceMs);
  const recoveryEvents = events.filter(
    (event) => event.recoveredAt != null && event.recoveredAt >= options.windowSinceMs
  );
  const stillBannedEvents = events.filter((event) => event.eventStatus !== 'recovered');

  return {
    confirmedBanEvents: confirmed,
    freshBanEvents,
    recoveryEvents,
    stillBannedEvents,
    observedAlreadyBannedEvents,
    observedAlreadyBanned24hEvents: observedAlreadyBannedEvents.filter(
      (event) => event.at >= options.freshSinceMs
    ),
    freshDrops24h: new Set(freshBanEvents.map(banEventIdentity)).size,
    freshDropEvents24h: freshBanEvents.length,
  };
}

export function scoreBanWave<TNode extends BanWaveNodeBase>(
  nodes: TNode[],
  durationSeconds: number
): { severity: BanWaveSeverity; score: number } {
  const count = nodes.length;
  if (count === 0) return { severity: 'low', score: 0 };

  const uniqueIps = new Set(nodes.map((node) => node.ip).filter(Boolean)).size || 1;
  const uniqueOperators =
    new Set(nodes.map((node) => node.operatorPubkey).filter(Boolean)).size || 1;
  const ipDiversity = uniqueIps / count;
  const operatorDiversity = uniqueOperators / count;
  const speedFactor = Math.max(0.2, 1 - durationSeconds / 3600);
  const score =
    Math.round(
      count * (1 / ipDiversity) * (1 / operatorDiversity) * (0.5 + speedFactor) * 10
    ) / 10;

  let severity: BanWaveSeverity = 'low';
  if (count >= 15 || score >= 80) severity = 'critical';
  else if (count >= 8 || score >= 40) severity = 'high';
  else if (count >= 5 || score >= 20) severity = 'moderate';
  return { severity, score };
}

export function buildBanWaves<TNode extends BanWaveNodeBase>(
  events: HistoricalBanEvent[],
  options: {
    windowSeconds: number;
    minNodes: number;
    toWaveNode: (event: HistoricalBanEvent) => TNode;
  }
): BanWave<TNode>[] {
  const sortedEvents = [...events].sort((a, b) => a.at - b.at);
  const usedKeys = new Set<string>();
  const waves: BanWave<TNode>[] = [];

  for (let index = 0; index < sortedEvents.length; index++) {
    const base = sortedEvents[index];
    const baseKey = `${banEventIdentity(base)}|${base.at}`;
    if (usedKeys.has(baseKey)) continue;

    const cluster: HistoricalBanEvent[] = [base];
    for (let next = index + 1; next < sortedEvents.length; next++) {
      if ((sortedEvents[next].at - base.at) / 1000 > options.windowSeconds) break;
      cluster.push(sortedEvents[next]);
    }

    const uniqueByNode = new Map<string, HistoricalBanEvent>();
    for (const event of cluster) uniqueByNode.set(banEventIdentity(event), event);
    const uniqueEvents = Array.from(uniqueByNode.values());
    if (uniqueEvents.length < options.minNodes) continue;

    const nodes = uniqueEvents.map(options.toWaveNode);
    const lastAt = uniqueEvents.reduce((latest, event) => Math.max(latest, event.at), base.at);
    const durationSeconds = Math.round((lastAt - base.at) / 1000);
    const uniqueIps = new Set(nodes.map((node) => node.ip).filter(Boolean));
    const uniqueOperators = new Set(nodes.map((node) => node.operatorPubkey).filter(Boolean));
    const countries = new Set(
      nodes.map((node) => node.countryCode).filter((country) => country && country !== 'UNK')
    );
    const providers = new Set(nodes.map((node) => node.provider).filter(Boolean) as string[]);
    const versions = new Set(
      nodes
        .map(
          (node) =>
            node.walletVersion ||
            (node.protocolVersion != null ? `protocol ${node.protocolVersion}` : '')
        )
        .filter(Boolean)
    );
    const recoveredCount = nodes.filter((node) => node.status === 'recovered').length;
    const stillBannedCount = nodes.filter((node) => node.status === 'still_banned').length;
    const severity = scoreBanWave(nodes, durationSeconds);

    waves.push({
      id: `wave-${base.at}`,
      startedAt: new Date(base.at).toISOString(),
      endedAt: new Date(lastAt).toISOString(),
      durationSeconds,
      windowSeconds: options.windowSeconds,
      totalNodes: nodes.length,
      bannedCount: nodes.length,
      recoveredCount,
      stillBannedCount,
      uniqueIps: uniqueIps.size,
      uniqueOperators: uniqueOperators.size,
      uniqueCountries: countries.size,
      countries: Array.from(countries).sort(),
      providers: Array.from(providers).sort(),
      versions: Array.from(versions).sort(),
      severity: severity.severity,
      severityScore: severity.score,
      nodes,
    });

    for (const event of cluster) {
      usedKeys.add(`${banEventIdentity(event)}|${event.at}`);
    }
  }

  return waves.sort(
    (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  );
}

import { buildBanWaves, type HistoricalBanEvent } from '../src/domain/pose/banAnalytics';
import { mapBanWaveNode } from '../src/domain/pose/banPresentation';
function event(id: string, asn: number | null, organization: string | null = 'Example network'): HistoricalBanEvent {
  return { nodeId: id, dedupeId: id, proTxHash: id, ip: `198.51.100.${id}`, service: 'example',
    previousStatus: 'ENABLED', currentStatus: 'POSE_BANNED', at: 1000, poseBanHeight: 100,
    detectedHeight: 100, countryCode: 'UNK', countryName: 'Unknown', operatorPubkey: null,
    payoutAddress: null, provider: null, providerSource: null, providerTagCidr: null, providerTagSource: null,
    providerConfidence: null, asn, asnOrg: organization, recoveredAt: null, recoveredHeight: null,
    recoveryTransition: null, eventStatus: 'banned' };
}
const wave = (events: HistoricalBanEvent[]) => buildBanWaves(events, { windowSeconds: 60, minNodes: 2,
  toWaveNode: e => mapBanWaveNode(e) })[0];
describe('wave ASN clusters', () => {
  it('counts distinct affected identities, not repeated observations or IPs, and includes unknown coverage', () => {
    const result = wave([event('1', 64500), event('1', 64500), event('2', 64500), event('3', null)]);
    expect(result.totalNodes).toBe(3); expect(result.asnKnownNodes).toBe(2); expect(result.asnUnknownNodes).toBe(1);
    expect(result.asnClusters).toEqual([{ asn: 64500, organization: 'Example network', nodes: 2, sharePct: 66.7 }]);
  });
  it('does not group unknown/invalid ASNs and never invents an organization from conflicting enrichment', () => {
    const result = wave([event('1', 64500, 'A'), event('2', 64500, 'B'), event('3', -1), event('4', 0)]);
    expect(result.asnClusters[0].organization).toBeNull(); expect(result.asnUnknownNodes).toBe(2);
  });
  it('keeps wave severity and node count independent of ASN metadata', () => {
    const a = wave([event('1', 64500), event('2', 64500)]), b = wave([event('1', null), event('2', null)]);
    expect(a.severityScore).toBe(b.severityScore); expect(a.totalNodes).toBe(b.totalNodes);
    expect(b.asnClusters).toEqual([]); expect(b.asnKnownNodes).toBe(0);
  });
});

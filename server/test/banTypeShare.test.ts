import type { PoseChainData } from '@defcon/shared/dist/contracts';
import { getBanTypeShare } from '../../client/src/utils/banTypeShare';

const row = (quorumType: number | null, newBans: number, unknownPenaltyCommitments = 0) => ({
  quorumType, newBans, unknownPenaltyCommitments, commitments: 100, verifiedCommitments: 100,
  unavailableCommitments: 0, nullCommitments: 0, participants: 400, invalidMembers: 90, penaltyApplications: 80,
});
function fixture(status: PoseChainData['status'] = 'ready', enabled = true): PoseChainData {
  return { status, penaltyCoverage: { enabled }, quorumSummary: [row(2, 3, 2), row(7, 1, 4), row(null, 1)] } as PoseChainData;
}
describe('verified ban share', () => {
  it('counts attributed ban events, including other types in the denominator', () => {
    expect(getBanTypeShare(fixture())).toEqual({ total: 5, type2: 3, q60: 1, other: 1,
      type2Pct: 60, q60Pct: 20, unknownCommitments: 6 });
  });
  it('fails closed for disabled attribution or untrusted collector status', () => {
    for (const status of ['disabled', 'collecting', 'stale', 'unavailable'] as const) {
      expect(getBanTypeShare(fixture(status)).type2Pct).toBeNull();
      expect(getBanTypeShare(fixture(status)).total).toBe(0);
    }
    expect(getBanTypeShare(fixture('ready', false)).type2Pct).toBeNull();
    expect(getBanTypeShare().type2Pct).toBeNull();
  });
  it('zero verified bans are unknown, even with verified invalid membership', () => {
    const data = fixture(); data.quorumSummary = [row(2, 0), row(7, 0)];
    expect(getBanTypeShare(data)).toMatchObject({ total: 0, type2Pct: null, q60Pct: null });
  });
  it('verified bans with no Type 2 contribution produce a real zero percent', () => {
    const data = fixture(); data.quorumSummary = [row(2, 0, 10), row(7, 2)];
    expect(getBanTypeShare(data)).toMatchObject({ total: 2, type2Pct: 0, q60Pct: 100, unknownCommitments: 10 });
  });
});

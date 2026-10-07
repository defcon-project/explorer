import type { PoseChainData } from '@defcon/shared/dist/contracts';

export function getBanTypeShare(data?: PoseChainData) {
  const trusted = data?.status === 'ready' && data.penaltyCoverage.enabled;
  const summary = trusted ? data.quorumSummary : [];
  const total = summary.reduce((sum, row) => sum + row.newBans, 0);
  const type2 = summary.filter((row) => row.quorumType === 2).reduce((sum, row) => sum + row.newBans, 0);
  const q60 = summary.filter((row) => row.quorumType === 7).reduce((sum, row) => sum + row.newBans, 0);
  return {
    total, type2, q60, other: total - type2 - q60,
    type2Pct: trusted && total > 0 ? type2 * 100 / total : null,
    q60Pct: trusted && total > 0 ? q60 * 100 / total : null,
    unknownCommitments: summary.reduce((sum, row) => sum + row.unknownPenaltyCommitments, 0),
  };
}

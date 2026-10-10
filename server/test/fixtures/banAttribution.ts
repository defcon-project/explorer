import { replayPenaltyAttribution } from '../../src/domain/pose/penaltyAttribution';
import { chainHash } from './poseChain';

export const attributionNow = new Date('2026-10-10T12:00:00Z');
export const attributionQuery = { proTxHash: chainHash(2), banHeight: 100 };
export function attributedBlock(multiple = false) {
  const before = [1, 2].map(id => ({ proTxHash: chainHash(id), penalty: id === 2 && !multiple ? 35 : 0,
    banHeight: -1, revivedHeight: -1, dslBanHeight: -1 }));
  const after = before.map(n => ({ ...n, penalty: n.proTxHash === chainHash(2) ? 100 : 0,
    banHeight: n.proTxHash === chainHash(2) ? 100 : -1 }));
  const commitments = (multiple ? [7, 2] : [7]).map((quorumType, i) => ({
    txid: chainHash(1000 + i), quorumType, quorumHash: chainHash(900 + i), status: 'verified' as const,
    members: [{ proTxHash: chainHash(1), valid: true }, { proTxHash: chainHash(2), valid: false }],
  }));
  const transactionTypes = multiple ? [5, 6, 6] : [5, 6];
  return { height: 100, hash: chainHash(100), previousHash: chainHash(99), canonical: true,
    time: new Date(attributionNow.getTime() - 60000), checkedAt: attributionNow, attributionCheckedAt: attributionNow,
    transactionTypes, commitments,
    penaltyAttribution: replayPenaltyAttribution(100, transactionTypes, commitments, before, after) };
}

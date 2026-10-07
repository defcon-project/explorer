import { describe, expect, it } from 'vitest';
import { decodeCommitment, verifiedCommitmentMembers } from '../src/domain/pose/commitment';
import mined from './fixtures/pose-chain-v23.json';
import { chainHash, commitmentPayload } from './fixtures/poseChain';

describe('v23 commitment payload and ordered membership', () => {
  it.each(mined.blocks)('decodes real mined block $height without counting empty slots as participants', (block) => {
    const tx = block.tx[0];
    const decoded = decodeCommitment(tx.extraPayload);
    expect(decoded).toMatchObject({ height: block.height, quorumHash: tx.quorumInfo.quorumHash, isNull: false });
    const members = verifiedCommitmentMembers(decoded, block.hash, tx.quorumInfo);
    expect(members).toEqual(tx.quorumInfo.members);
    expect(members.filter((member) => !member.valid)).toHaveLength(2);
    expect(decoded.validMembers).toHaveLength(block.height === 147909 ? 400 : 60);
    expect(members).toHaveLength(block.height === 147909 ? 161 : 60);
  });

  it.each([1, 2, 3, 4])('decodes commitment version %i, including indexed layouts', (version) => {
    const decoded = decodeCommitment(commitmentPayload({ version, quorumIndex: 3 }));
    expect(decoded).toMatchObject({ version, quorumIndex: version === 2 || version === 4 ? 3 : 0,
      signers: [true, false], validMembers: [true, false], quorumType: 7 });
  });

  it('decodes null commitments and canonical long bitsets', () => {
    expect(decodeCommitment(commitmentPayload({ isNull: true })).isNull).toBe(true);
    expect(decodeCommitment(commitmentPayload({ validMembers: Array(400).fill(false) })).validMembers).toHaveLength(400);
  });

  it('rejects unsupported versions, truncation, trailing bytes and malformed hex', () => {
    const raw = commitmentPayload();
    for (const value of [commitmentPayload({ version: 5 }), commitmentPayload({ payloadVersion: 2 }),
      raw.slice(0, -2), `${raw}00`, '0', 'zz', '00'.repeat(8193), commitmentPayload({ quorumIndex: -1, version: 4 })]) {
      expect(() => decodeCommitment(value)).toThrow();
    }
  });

  it('rejects inconsistent bitsets, noncanonical sizes and dirty padding', () => {
    expect(() => decodeCommitment(commitmentPayload({ signers: [true] }))).toThrow(/bitsets/);
    const raw = Buffer.from(commitmentPayload(), 'hex');
    raw[42] = 0x81;
    expect(() => decodeCommitment(raw.toString('hex'))).toThrow(/padding/);
    const good = Buffer.from(commitmentPayload(), 'hex');
    const noncanonical = Buffer.concat([good.subarray(0, 41), Buffer.from([253, 2, 0]), good.subarray(42)]);
    expect(() => decodeCommitment(noncanonical.toString('hex'))).toThrow(/noncanonical/);
  });

  it('rejects mismatched anchors, order, duplicate identities and missing true slots', () => {
    const decoded = decodeCommitment(commitmentPayload());
    const info = { quorumHash: decoded.quorumHash, minedBlock: chainHash(100), quorumIndex: 0,
      members: [{ proTxHash: chainHash(1), valid: true }, { proTxHash: chainHash(2), valid: false }] };
    for (const value of [{ ...info, minedBlock: chainHash(101) }, { ...info, quorumHash: chainHash(901) },
      { ...info, quorumIndex: 1 }, { ...info, members: [...info.members].reverse() },
      { ...info, members: [info.members[0], info.members[0]] }, { ...info, members: [] },
      { ...info, members: [info.members[1]] }]) {
      expect(() => verifiedCommitmentMembers(decoded, chainHash(100), value)).toThrow();
    }
    const short = { ...info, members: [info.members[0]] };
    expect(verifiedCommitmentMembers(decoded, chainHash(100), short)).toHaveLength(1);
    const signerOutside = decodeCommitment(commitmentPayload({ signers: [true, true] }));
    expect(() => verifiedCommitmentMembers(signerOutside, chainHash(100), short)).toThrow();
  });
});

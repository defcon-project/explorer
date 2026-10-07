import { z } from 'zod';

export const chainHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type DecodedCommitment = {
  payloadVersion: number; height: number; version: number; quorumType: number;
  quorumHash: string; quorumIndex: number; signers: boolean[]; validMembers: boolean[]; isNull: boolean;
};

/** v23 CFinalCommitmentTxPayload v1 and commitment v1–v4, not a signature verifier.
 * Source: defcon-project/defcon a06830f src/llmq/commitment.h.
 * Canonicality must be checked separately against the daemon's active chain. */
export function decodeCommitment(hex: string): DecodedCommitment {
  if (!/^(?:[a-fA-F0-9]{2})+$/.test(hex) || hex.length > 16384) throw new Error('Invalid commitment payload');
  const data = Buffer.from(hex, 'hex');
  let offset = 0;
  const take = (size: number) => {
    if (offset + size > data.length) throw new Error('Truncated commitment payload');
    const part = data.subarray(offset, offset + size); offset += size; return part;
  };
  const u16 = () => take(2).readUInt16LE();
  const compactSize = () => {
    const prefix = take(1)[0];
    const value = prefix < 253 ? prefix : prefix === 253 ? u16() : prefix === 254 ? take(4).readUInt32LE() : -1;
    if (value < 0 || value > 4096 || (prefix === 253 && value < 253) || (prefix === 254 && value < 65536)) {
      throw new Error('Unsupported/noncanonical commitment bitset size');
    }
    return value;
  };
  const bits = () => {
    const size = compactSize(); const bytes = take(Math.ceil(size / 8));
    if (size % 8 && (bytes[bytes.length - 1] >> (size % 8)) !== 0) throw new Error('Nonzero bitset padding');
    return Array.from({ length: size }, (_, i) => Boolean(bytes[Math.floor(i / 8)] & (1 << (i % 8))));
  };
  const payloadVersion = u16();
  if (payloadVersion !== 1) throw new Error('Unsupported commitment payload version');
  const height = take(4).readUInt32LE(); const version = u16();
  if (![1, 2, 3, 4].includes(version)) throw new Error('Unsupported commitment version');
  const quorumType = take(1)[0];
  const quorumHash = Buffer.from(take(32)).reverse().toString('hex');
  const quorumIndex = version === 2 || version === 4 ? take(2).readInt16LE() : 0;
  if (quorumIndex < 0) throw new Error('Invalid quorum index');
  const signers = bits(); const validMembers = bits();
  if (!signers.length || signers.length !== validMembers.length) throw new Error('Inconsistent commitment bitsets');
  const cryptoFields = take(48 + 32 + 96 + 96);
  if (offset !== data.length) throw new Error('Trailing commitment bytes');
  const isNull = !signers.some(Boolean) && !validMembers.some(Boolean) && cryptoFields.every((byte) => byte === 0);
  return { payloadVersion, height, version, quorumType, quorumHash, quorumIndex, signers, validMembers, isNull };
}

const quorumInfoSchema = z.object({
  quorumHash: chainHashSchema, minedBlock: chainHashSchema, quorumIndex: z.number().int().nonnegative(),
  members: z.array(z.object({ proTxHash: chainHashSchema, valid: z.boolean() })).max(4096),
});

export function verifiedCommitmentMembers(commitment: DecodedCommitment, blockHash: string, value: unknown) {
  const info = quorumInfoSchema.parse(value);
  if (info.quorumHash !== commitment.quorumHash || info.minedBlock !== blockHash || info.quorumIndex !== commitment.quorumIndex) {
    throw new Error('Quorum info does not identify this mined commitment');
  }
  if (!info.members.length || info.members.length > commitment.validMembers.length
    || new Set(info.members.map((member) => member.proTxHash)).size !== info.members.length
    || commitment.validMembers.slice(info.members.length).some(Boolean)
    || commitment.signers.slice(info.members.length).some(Boolean)
    || info.members.some((member, i) => member.valid !== commitment.validMembers[i])) {
    throw new Error('Quorum membership disagrees with commitment bitset');
  }
  return info.members;
}

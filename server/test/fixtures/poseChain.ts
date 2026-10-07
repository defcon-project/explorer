// Synthetic serialization follows v23 CFinalCommitmentTxPayload/DYNBITSET.
// The separate JSON fixture contains real mined v1 payloads and ordered RPC members.
export const chainHash = (value: number) => value.toString(16).padStart(64, '0');

export function commitmentPayload(options: {
  height?: number; version?: number; payloadVersion?: number; quorumType?: number;
  quorumHash?: string; quorumIndex?: number; validMembers?: boolean[]; signers?: boolean[]; isNull?: boolean;
} = {}) {
  const version = options.version ?? 1;
  const header = Buffer.alloc(version === 2 || version === 4 ? 43 : 41);
  header.writeUInt16LE(options.payloadVersion ?? 1, 0);
  header.writeUInt32LE(options.height ?? 100, 2);
  header.writeUInt16LE(version, 6);
  header[8] = options.quorumType ?? 7;
  Buffer.from(options.quorumHash ?? chainHash(900), 'hex').reverse().copy(header, 9);
  if (version === 2 || version === 4) header.writeInt16LE(options.quorumIndex ?? 0, 41);
  const validMembers = options.validMembers ?? (options.isNull ? [false, false] : [true, false]);
  const signers = options.signers ?? validMembers;
  const bits = (values: boolean[]) => {
    const prefix = Buffer.alloc(values.length < 253 ? 1 : 3);
    prefix[0] = values.length < 253 ? values.length : 253;
    if (values.length >= 253) prefix.writeUInt16LE(values.length, 1);
    const bytes = Buffer.alloc(Math.ceil(values.length / 8));
    values.forEach((value, i) => { if (value) bytes[Math.floor(i / 8)] |= 1 << (i % 8); });
    return Buffer.concat([prefix, bytes]);
  };
  return Buffer.concat([header, bits(signers), bits(validMembers),
    Buffer.alloc(48 + 32 + 96 + 96, options.isNull ? 0 : 1)]).toString('hex');
}

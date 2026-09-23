import crypto from 'crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX: Record<string, number> = Object.fromEntries(
  [...BASE58_ALPHABET].map((ch, i) => [ch, i])
);

function sha256(data: Uint8Array): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

function doubleSha256(data: Uint8Array): Buffer {
  return sha256(sha256(data));
}

export function base58Encode(data: Uint8Array): string {
  const buf = Buffer.from(data);
  if (buf.length === 0) return '';

  let x = BigInt(`0x${buf.toString('hex')}`);
  let out = '';
  while (x > 0n) {
    const mod = x % 58n;
    out = BASE58_ALPHABET[Number(mod)] + out;
    x /= 58n;
  }

  // Preserve leading zeros as '1'
  for (const b of buf) {
    if (b !== 0) break;
    out = '1' + out;
  }

  return out || '1';
}

export function base58Decode(str: string): Uint8Array {
  if (!str) throw new Error('Invalid base58 string');

  let x = 0n;
  for (const ch of str) {
    const idx = BASE58_INDEX[ch];
    if (idx === undefined) throw new Error('Invalid base58 character');
    x = x * 58n + BigInt(idx);
  }

  let hex = x.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = x === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');

  // Restore leading zero bytes from leading '1's
  let leading = 0;
  for (const ch of str) {
    if (ch !== '1') break;
    leading++;
  }
  if (leading > 0) {
    bytes = Buffer.concat([Buffer.alloc(leading), bytes]);
  }

  return bytes;
}

export function base58CheckEncode(payload: Uint8Array): string {
  const checksum = doubleSha256(payload).subarray(0, 4);
  return base58Encode(Buffer.concat([Buffer.from(payload), checksum]));
}

export function base58CheckDecode(str: string): Uint8Array {
  const bytes = Buffer.from(base58Decode(str));
  if (bytes.length < 5) throw new Error('Invalid base58check length');

  const payload = bytes.subarray(0, -4);
  const checksum = bytes.subarray(-4);
  const expected = doubleSha256(payload).subarray(0, 4);
  if (!checksum.equals(expected)) throw new Error('Invalid base58check checksum');

  return payload;
}

export function tryGetBase58CheckVersionByte(address: string): number | null {
  try {
    const payload = base58CheckDecode(address);
    if (payload.length < 1) return null;
    return payload[0];
  } catch {
    return null;
  }
}

function hash160(data: Uint8Array): Buffer {
  const sha = sha256(data);
  return crypto.createHash('ripemd160').update(sha).digest();
}

export function pubkeyHexToP2pkhAddress(pubkeyHex: string, versionByte: number): string {
  if (!Number.isInteger(versionByte) || versionByte < 0 || versionByte > 255) {
    throw new Error('Invalid P2PKH version byte');
  }

  const pubkey = Buffer.from(pubkeyHex, 'hex');
  const h160 = hash160(pubkey);
  const payload = Buffer.concat([Buffer.from([versionByte]), h160]);
  return base58CheckEncode(payload);
}

export function extractPubkeyHexFromAsm(asm: string): string | null {
  const parts = (asm || '').trim().split(/\s+/).filter(Boolean);
  for (const token of parts) {
    const t = token.toLowerCase();
    if (/^[0-9a-f]+$/.test(t) && (t.length === 66 || t.length === 130)) {
      return t;
    }
  }
  return null;
}


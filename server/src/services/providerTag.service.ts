import { ProviderTag } from '../models/ProviderTag';

export type ProviderTagSource = 'operator_reported' | 'manual' | 'asn' | 'rdns';

export interface ProviderTagMatch {
  cidr: string;
  provider: string;
  source: ProviderTagSource;
  confidence: number;
  reporter: string | null;
  evidenceUrl: string | null;
}

interface ParsedTag extends ProviderTagMatch {
  start: number;
  end: number;
  prefix: number;
}

export interface ProviderTagBulkInvalidLine {
  lineNumber: number;
  value: string;
  reason: string;
}

export interface ProviderTagBulkParseResult {
  totalLines: number;
  validEntries: string[];
  duplicatesSkipped: number;
  invalidLines: ProviderTagBulkInvalidLine[];
}

const TAG_CACHE_TTL_MS = 5 * 60 * 1000;

let tagCache: { atMs: number; tags: ParsedTag[] } | null = null;
let pendingLoad: Promise<ParsedTag[]> | null = null;

function ipv4ToUint(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map((s) => Number.parseInt(s, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return (((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function parseCidr(input: string): { start: number; end: number; prefix: number } | null {
  const value = String(input || '').trim();
  if (!value) return null;

  const parts = value.split('/');
  const ip = parts[0]?.trim();
  if (!ip) return null;

  const ipNum = ipv4ToUint(ip);
  if (ipNum == null) return null;

  const prefixRaw = parts.length === 2 ? parts[1].trim() : '32';
  const prefix = Number.parseInt(prefixRaw, 10);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return null;

  const hostBits = 32 - prefix;
  const mask = prefix === 0 ? 0 : (0xffffffff << hostBits) >>> 0;
  const start = (ipNum & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return { start, end, prefix };
}

function isValidIpv4(ip: string): boolean {
  return ipv4ToUint(ip) != null;
}

function normalizeCidrFormat(cidr: string): string {
  const [ipPart, prefixPart] = cidr.split('/');
  const ip = String(ipPart || '').trim();
  const prefix = Number.parseInt(String(prefixPart || '32').trim(), 10);
  return `${ip}/${prefix}`;
}

export function normalizeProviderTagEntry(input: string): string | null {
  const value = String(input || '').trim();
  if (!value) return null;

  let candidate = value;
  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
  if (ipv4WithPort) {
    candidate = ipv4WithPort[1];
  }

  if (candidate.includes('/')) {
    if (!isValidIpv4Cidr(candidate)) return null;
    return normalizeCidrFormat(candidate);
  }

  if (!isValidIpv4(candidate)) return null;
  return `${candidate}/32`;
}

export function parseProviderTagBulkEntries(rawLines: string[]): ProviderTagBulkParseResult {
  const totalLines = Array.isArray(rawLines) ? rawLines.length : 0;
  const validEntries: string[] = [];
  const invalidLines: ProviderTagBulkInvalidLine[] = [];
  const dedup = new Set<string>();
  let duplicatesSkipped = 0;

  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { totalLines: 0, validEntries, duplicatesSkipped, invalidLines };
  }

  rawLines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = String(rawLine ?? '').trim();
    if (!line) return;

    const normalized = normalizeProviderTagEntry(line);
    if (!normalized) {
      invalidLines.push({
        lineNumber,
        value: line,
        reason: 'Invalid IPv4, IPv4:port, or IPv4 CIDR',
      });
      return;
    }

    const dedupKey = normalized.toLowerCase();
    if (dedup.has(dedupKey)) {
      duplicatesSkipped += 1;
      return;
    }

    dedup.add(dedupKey);
    validEntries.push(normalized);
  });

  return {
    totalLines,
    validEntries,
    duplicatesSkipped,
    invalidLines,
  };
}

export function isValidIpv4Cidr(input: string): boolean {
  return parseCidr(input) != null;
}

function toProviderTagMatch(tag: ParsedTag): ProviderTagMatch {
  return {
    cidr: tag.cidr,
    provider: tag.provider,
    source: tag.source,
    confidence: tag.confidence,
    reporter: tag.reporter,
    evidenceUrl: tag.evidenceUrl,
  };
}

function findBestTagForIpNum(ipNum: number, tags: ParsedTag[]): ParsedTag | null {
  for (const tag of tags) {
    if (ipNum >= tag.start && ipNum <= tag.end) return tag;
  }
  return null;
}

function isActiveTagWindow(now: Date, validFrom?: Date | null, validTo?: Date | null): boolean {
  if (validFrom instanceof Date && Number.isFinite(validFrom.getTime()) && validFrom.getTime() > now.getTime()) {
    return false;
  }
  if (validTo instanceof Date && Number.isFinite(validTo.getTime()) && validTo.getTime() < now.getTime()) {
    return false;
  }
  return true;
}

async function loadActiveProviderTags(): Promise<ParsedTag[]> {
  const now = Date.now();
  if (tagCache && now - tagCache.atMs < TAG_CACHE_TTL_MS) {
    return tagCache.tags;
  }
  if (pendingLoad) return pendingLoad;

  pendingLoad = (async () => {
    const nowDate = new Date();
    const rows = await ProviderTag.find({ active: true })
      .select({
        cidr: 1,
        provider: 1,
        source: 1,
        confidence: 1,
        reporter: 1,
        evidenceUrl: 1,
        validFrom: 1,
        validTo: 1,
      })
      .lean<
        Array<{
          cidr: string;
          provider: string;
          source: ProviderTagSource;
          confidence?: number | null;
          reporter?: string | null;
          evidenceUrl?: string | null;
          validFrom?: Date | null;
          validTo?: Date | null;
        }>
      >();

    const parsed: ParsedTag[] = [];
    for (const row of rows) {
      if (!isActiveTagWindow(nowDate, row.validFrom, row.validTo)) continue;
      const cidr = String(row.cidr || '').trim();
      const provider = String(row.provider || '').trim();
      if (!cidr || !provider) continue;

      const range = parseCidr(cidr);
      if (!range) continue;

      parsed.push({
        cidr,
        provider,
        source: row.source || 'manual',
        confidence:
          typeof row.confidence === 'number' && Number.isFinite(row.confidence)
            ? Math.max(0, Math.min(100, Math.round(row.confidence)))
            : 85,
        reporter: row.reporter ? String(row.reporter).trim() : null,
        evidenceUrl: row.evidenceUrl ? String(row.evidenceUrl).trim() : null,
        ...range,
      });
    }

    parsed.sort((a, b) => b.prefix - a.prefix || a.cidr.localeCompare(b.cidr));
    tagCache = { atMs: Date.now(), tags: parsed };
    return parsed;
  })().finally(() => {
    pendingLoad = null;
  });

  return pendingLoad;
}

export async function resolveProviderTag(ip: string): Promise<ProviderTagMatch | null> {
  const ipNum = ipv4ToUint(String(ip || '').trim());
  if (ipNum == null) return null;

  const tags = await loadActiveProviderTags();
  const match = findBestTagForIpNum(ipNum, tags);
  return match ? toProviderTagMatch(match) : null;
}

export async function resolveProviderTagsBulk(
  ips: string[]
): Promise<Map<string, ProviderTagMatch>> {
  const matches = new Map<string, ProviderTagMatch>();
  if (!Array.isArray(ips) || ips.length === 0) return matches;

  const tags = await loadActiveProviderTags();
  const uniqueIps = new Set<string>();
  for (const rawIp of ips) {
    const normalized = String(rawIp || '').trim().toLowerCase();
    if (!normalized || uniqueIps.has(normalized)) continue;
    uniqueIps.add(normalized);

    const ipNum = ipv4ToUint(normalized);
    if (ipNum == null) continue;

    const tag = findBestTagForIpNum(ipNum, tags);
    if (tag) {
      matches.set(normalized, toProviderTagMatch(tag));
    }
  }

  return matches;
}

export function clearProviderTagCache(): void {
  tagCache = null;
  pendingLoad = null;
}

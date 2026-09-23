import { promises as dns } from 'dns';
import { isIP } from 'net';
import { existsSync } from 'fs';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Provider lookup service.
 *
 * Resolves a hosting provider name (and best-effort ASN info) for an IP/host
 * using a layered strategy:
 *
 *   1. Local in-memory cache (24h positive, 6h negative)
 *   2. Reverse DNS (PTR) regex matching against a curated pattern list
 *   3. MaxMind GeoLite2-ASN local mmdb (if GEOIP_ASN_MMDB env points to a file
 *      and the optional `maxmind` package is installed)
 *   4. ip-api.com batch API (HTTP, no key, 45 req/min — auto-rate-limited)
 *
 * Each layer is best-effort: missing data simply falls through to the next.
 */

export interface ProviderInfo {
  provider: string;
  asn: number | null;
  asnOrg: string | null;
  source: 'tor' | 'cache' | 'ptr' | 'mmdb' | 'ipapi' | 'tag' | 'unknown';
}

export const UNKNOWN_PROVIDER = 'Unknown';

const POSITIVE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const NEGATIVE_TTL_MS = 1000 * 60 * 60 * 6; // 6h
const PTR_TIMEOUT_MS = 1200;
const IP_API_BATCH_SIZE = 100; // ip-api.com hard limit
const IP_API_RATE_LIMIT_PER_MIN = 45;
const IP_API_BACKOFF_BASE_MS = 30_000;
const IP_API_BACKOFF_MAX_MS = 10 * 60_000;

// ip-api.com offers free HTTP and pro HTTPS (with key). Default to plain HTTP
// to keep the free tier working out of the box, but operators with a pro key
// can flip IP_API_HTTPS=true and pass IP_API_KEY to get a MITM-resistant
// transport. The risk on free HTTP is metadata leakage and response tampering;
// the latter is mitigated downstream by sanitizeProviderName().
const IP_API_USE_HTTPS = config.providerLookup.ipApiUseHttps;
const IP_API_KEY = config.providerLookup.ipApiKey;
const IP_API_BASE = IP_API_USE_HTTPS
  ? 'https://pro.ip-api.com/batch'
  : 'http://ip-api.com/batch';
const IP_API_ENDPOINT =
  `${IP_API_BASE}?fields=status,query,isp,org,as` +
  (IP_API_USE_HTTPS && IP_API_KEY ? `&key=${encodeURIComponent(IP_API_KEY)}` : '');

interface CacheEntry {
  info: ProviderInfo;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<ProviderInfo>>();

// ─── Provider patterns (greatly expanded) ───────────────────────────────────
// Order matters: more specific first.
interface ProviderPattern {
  provider: string;
  pattern: RegExp;
}

const PROVIDER_PATTERNS: ProviderPattern[] = [
  // Tier 1 — most common MN hosting
  { provider: 'Hetzner', pattern: /(hetzner|your-server\.de|hetzner\.cloud|hetzner-cloud|static\.\d+\.\d+\.\d+\.\d+\.clients\.your-server)/i },
  { provider: 'Contabo', pattern: /(contabo|contaboserver\.net|m\.contabo)/i },
  { provider: 'Vultr', pattern: /(vultr|vultrusercontent|choopa)/i },
  { provider: 'OVH', pattern: /(ovh|kimsufi|soyoustart|ovhcloud|ip-\d+-\d+-\d+-\d+\.eu)/i },
  { provider: 'DigitalOcean', pattern: /(digitalocean|digital-ocean)/i },
  { provider: 'Linode', pattern: /(linode|members\.linode)/i },
  { provider: 'Akamai', pattern: /(akamai|akamaitechnologies|akamaihd)/i },
  { provider: 'AWS', pattern: /(amazonaws|ec2-|compute\.amazonaws|aws\.amazon)/i },
  { provider: 'Google Cloud', pattern: /(googleusercontent|bc\.googleusercontent|google\.com\.)/i },
  { provider: 'Azure', pattern: /(cloudapp\.net|azure|microsoft|azurewebsites|microsoftonline)/i },
  { provider: 'Oracle Cloud', pattern: /(oraclecloud|oraclevcn)/i },

  // Tier 2 — popular European VPS
  { provider: 'Scaleway', pattern: /(scaleway|scw\.cloud|online\.net|iliad)/i },
  { provider: 'Netcup', pattern: /(netcup|v\d+\.your-host\.de)/i },
  { provider: 'IONOS', pattern: /(ionos|1and1|1&1|home\.pl)/i },
  { provider: 'Strato', pattern: /(strato|stratoserver)/i },
  { provider: 'Aruba', pattern: /(aruba\.it|arubacloud|aruba-cloud)/i },
  { provider: 'Leaseweb', pattern: /(leaseweb|leaseweb\.com)/i },
  { provider: 'Webtropia', pattern: /(webtropia|myloc)/i },
  { provider: 'GTHost', pattern: /(gthost|globaltelehost)/i },
  { provider: 'Worldstream', pattern: /(worldstream)/i },
  { provider: 'M247', pattern: /(m247)/i },
  { provider: 'Mevspace', pattern: /(mevspace|mev-space)/i },
  { provider: 'Liteserver', pattern: /(liteserver)/i },
  { provider: 'i3D', pattern: /(i3d\.net|i3dnet)/i },

  // Tier 3 — niche / privacy-friendly / budget
  { provider: 'BuyVM/FranTech', pattern: /(buyvm|frantech)/i },
  { provider: 'Servarica', pattern: /(servarica)/i },
  { provider: 'Hostkey', pattern: /(hostkey)/i },
  { provider: 'INWX', pattern: /(inwx)/i },
  { provider: 'Greenhost', pattern: /(greenhost)/i },
  { provider: 'NFOrce', pattern: /(nforce)/i },

  // Tier 4 — Asia-Pacific
  { provider: 'Alibaba Cloud', pattern: /(alibaba|aliyun|alicloud)/i },
  { provider: 'Tencent Cloud', pattern: /(tencent|qcloud|tencentcloud)/i },
  { provider: 'Yandex Cloud', pattern: /(yandex\.cloud|yandexcloud|yandex\.net)/i },
  { provider: 'NTT', pattern: /(ntt\.com|nttdocomo)/i },

  // Tier 5 — CDN / edge
  { provider: 'Cloudflare', pattern: /(cloudflare)/i },
  { provider: 'Fastly', pattern: /(fastly)/i },
  { provider: 'Zenlayer', pattern: /(zenlayer)/i },
  { provider: 'GCorelabs', pattern: /(gcorelabs|g-core)/i },

  // Tier 6 — bulletproof / known-bad reputation (useful for MN security)
  { provider: 'Stark Industries', pattern: /(stark[\-\s]?industries|pq\.hosting)/i },
  { provider: 'ColocationAmerica', pattern: /(colocationamerica)/i },

  // Generic ASN-org → friendly name fallbacks (used when we have AS org from mmdb/ip-api)
];

// Patterns matched against MaxMind/ip-api ASN org strings (long, descriptive).
const ASN_ORG_PATTERNS: ProviderPattern[] = [
  { provider: 'Hetzner', pattern: /hetzner/i },
  { provider: 'Contabo', pattern: /contabo/i },
  { provider: 'Vultr', pattern: /(vultr|choopa)/i },
  { provider: 'OVH', pattern: /(ovh|kimsufi|soyoustart)/i },
  { provider: 'DigitalOcean', pattern: /digitalocean/i },
  { provider: 'Linode', pattern: /(linode|akamai connected cloud)/i },
  { provider: 'Akamai', pattern: /akamai/i },
  { provider: 'AWS', pattern: /(amazon|aws)/i },
  { provider: 'Google Cloud', pattern: /(google|alphabet)/i },
  { provider: 'Azure', pattern: /microsoft/i },
  { provider: 'Oracle Cloud', pattern: /oracle/i },
  { provider: 'Scaleway', pattern: /(scaleway|iliad|free sas)/i },
  { provider: 'Netcup', pattern: /netcup/i },
  { provider: 'IONOS', pattern: /(ionos|1\s?&\s?1)/i },
  { provider: 'Strato', pattern: /strato/i },
  { provider: 'Aruba', pattern: /aruba/i },
  { provider: 'Leaseweb', pattern: /leaseweb/i },
  { provider: 'Webtropia', pattern: /(webtropia|myloc)/i },
  { provider: 'GTHost', pattern: /(gthost|global telehost)/i },
  { provider: 'Worldstream', pattern: /worldstream/i },
  { provider: 'M247', pattern: /m247/i },
  { provider: 'Mevspace', pattern: /mevspace/i },
  { provider: 'Liteserver', pattern: /liteserver/i },
  { provider: 'i3D', pattern: /i3d/i },
  { provider: 'BuyVM/FranTech', pattern: /(buyvm|frantech)/i },
  { provider: 'Servarica', pattern: /servarica/i },
  { provider: 'Hostkey', pattern: /hostkey/i },
  { provider: 'Alibaba Cloud', pattern: /(alibaba|aliyun)/i },
  { provider: 'Tencent Cloud', pattern: /tencent/i },
  { provider: 'Yandex Cloud', pattern: /yandex/i },
  { provider: 'NTT', pattern: /ntt/i },
  { provider: 'Cloudflare', pattern: /cloudflare/i },
  { provider: 'Fastly', pattern: /fastly/i },
  { provider: 'Zenlayer', pattern: /zenlayer/i },
  { provider: 'GCorelabs', pattern: /(gcorelabs|g-core)/i },
  { provider: 'Stark Industries', pattern: /(stark industries|pq\.hosting|pq hosting)/i },
];

function inferFromText(text: string, patterns: ProviderPattern[]): string | null {
  if (!text) return null;
  for (const p of patterns) {
    if (p.pattern.test(text)) return p.provider;
  }
  return null;
}

// ─── PTR layer ──────────────────────────────────────────────────────────────
async function reverseLookup(ip: string): Promise<string[]> {
  if (!isIP(ip)) return [];
  try {
    return await Promise.race([
      dns.reverse(ip),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), PTR_TIMEOUT_MS)),
    ]);
  } catch {
    return [];
  }
}

// ─── MaxMind layer (lazy, optional) ─────────────────────────────────────────
type MmdbReader = {
  get: (ip: string) => { autonomous_system_number?: number; autonomous_system_organization?: string } | null;
};

let mmdbReader: MmdbReader | null = null;
let mmdbInitialized = false;

async function initMmdb(): Promise<void> {
  if (mmdbInitialized) return;
  mmdbInitialized = true;
  const path = config.providerLookup.geoipAsnMmdbPath;
  if (!path) return;
  if (!existsSync(path)) {
    logger.warn(`[providerLookup] GEOIP_ASN_MMDB set but file not found: ${path}`);
    return;
  }
  try {
    // Optional dependency — only loaded if the user installs it
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const maxmind = require('maxmind') as { open: (p: string) => Promise<MmdbReader> };
    mmdbReader = await maxmind.open(path);
    logger.info(`[providerLookup] MaxMind ASN database loaded from ${path}`);
  } catch (err) {
    logger.warn(
      `[providerLookup] Failed to load MaxMind ASN database (is the "maxmind" package installed?): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function lookupMmdb(ip: string): { asn: number | null; asnOrg: string | null } {
  if (!mmdbReader || !isIP(ip)) return { asn: null, asnOrg: null };
  try {
    const rec = mmdbReader.get(ip);
    if (!rec) return { asn: null, asnOrg: null };
    return {
      asn: typeof rec.autonomous_system_number === 'number' ? rec.autonomous_system_number : null,
      asnOrg:
        typeof rec.autonomous_system_organization === 'string' ? rec.autonomous_system_organization : null,
    };
  } catch {
    return { asn: null, asnOrg: null };
  }
}

// ─── ip-api.com batch layer ─────────────────────────────────────────────────
let ipApiCallTimes: number[] = []; // ms timestamps within the last minute
let ipApiBackoffMs = 0;
let ipApiCooldownUntilMs = 0;

function noteIpApiFailure(reason: string): void {
  ipApiBackoffMs = ipApiBackoffMs > 0
    ? Math.min(IP_API_BACKOFF_MAX_MS, ipApiBackoffMs * 2)
    : IP_API_BACKOFF_BASE_MS;
  ipApiCooldownUntilMs = Date.now() + ipApiBackoffMs;
  logger.warn(`[providerLookup] ip-api cooldown ${Math.round(ipApiBackoffMs / 1000)}s (${reason})`);
}

function noteIpApiSuccess(): void {
  ipApiBackoffMs = 0;
  ipApiCooldownUntilMs = 0;
}

function canCallIpApi(): boolean {
  if (!config.providerLookup.ipApiEnabled) return false;
  const now = Date.now();
  if (now < ipApiCooldownUntilMs) return false;
  ipApiCallTimes = ipApiCallTimes.filter((t) => now - t < 60_000);
  return ipApiCallTimes.length < IP_API_RATE_LIMIT_PER_MIN;
}

interface IpApiResponseEntry {
  status: string;
  query: string;
  isp?: string;
  org?: string;
  as?: string;
}

async function ipApiBatch(ips: string[]): Promise<Map<string, { asn: number | null; asnOrg: string | null }>> {
  const out = new Map<string, { asn: number | null; asnOrg: string | null }>();
  if (ips.length === 0) return out;
  if (!canCallIpApi()) {
    if (Date.now() >= ipApiCooldownUntilMs) {
      noteIpApiFailure('rate-limit/local cooldown');
    }
    return out;
  }

  ipApiCallTimes.push(Date.now());

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.providerLookup.ipApiBatchTimeoutMs);
  try {
    const res = await fetch(IP_API_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ips.map((q) => ({ query: q }))),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`[providerLookup] ip-api.com batch returned HTTP ${res.status}`);
      noteIpApiFailure(`http-${res.status}`);
      return out;
    }
    const json = (await res.json()) as IpApiResponseEntry[];
    let successCount = 0;
    for (const entry of json) {
      if (entry.status !== 'success') continue;
      successCount += 1;
      // "as" looks like "AS24940 Hetzner Online GmbH"
      const asField = entry.as || '';
      let asn: number | null = null;
      let asnOrg: string | null = null;
      const m = asField.match(/^AS(\d+)\s*(.*)$/i);
      if (m) {
        asn = parseInt(m[1], 10);
        asnOrg = m[2].trim() || entry.org || entry.isp || null;
      } else {
        asnOrg = entry.org || entry.isp || asField || null;
      }
      // Defense-in-depth: ip-api.com is an external, untrusted source. Sanitize
      // organization names before caching them so a compromised upstream cannot
      // poison the cache with HTML/control characters or oversized strings that
      // would later be rendered in the UI or written to logs.
      out.set(entry.query, { asn, asnOrg: sanitizeProviderName(asnOrg) });
    }
    if (successCount > 0) {
      noteIpApiSuccess();
    } else {
      noteIpApiFailure('empty-success-payload');
    }
  } catch (err) {
    if ((err as { name?: string }).name !== 'AbortError') {
      logger.warn(
        `[providerLookup] ip-api.com batch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    noteIpApiFailure((err as { name?: string }).name === 'AbortError' ? 'abort' : 'fetch-error');
  } finally {
    clearTimeout(t);
  }
  return out;
}

const PROVIDER_NAME_MAX_LEN = 80;

function sanitizeProviderName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  // Strip control chars and HTML angle brackets, collapse whitespace, cap length.
  // We allow only printable, common-org-name characters.
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, PROVIDER_NAME_MAX_LEN);
}

// ─── Core resolver ──────────────────────────────────────────────────────────
function getCached(key: string): ProviderInfo | null {
  const e = cache.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return e.info;
}

function setCached(key: string, info: ProviderInfo): void {
  const ttl = info.provider === UNKNOWN_PROVIDER ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
  cache.set(key, { info, expiresAt: Date.now() + ttl });
}

function makeInfo(
  provider: string,
  source: ProviderInfo['source'],
  asn: number | null = null,
  asnOrg: string | null = null,
): ProviderInfo {
  return { provider, source, asn, asnOrg };
}

/**
 * Resolve a single host's provider info. Uses cache + PTR + (optional) MaxMind.
 * Does NOT call ip-api.com here — batch lookups should use `bulkResolveProviders()`.
 */
export async function resolveProviderInfo(host: string, isTor: boolean): Promise<ProviderInfo> {
  if (isTor) return makeInfo('Tor', 'tor');

  const key = String(host || '').trim().toLowerCase();
  if (!key) return makeInfo(UNKNOWN_PROVIDER, 'unknown');

  const cached = getCached(key);
  if (cached) return cached;

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<ProviderInfo> => {
    await initMmdb();

    // 1) PTR
    const ptrs = await reverseLookup(key);
    let provider = inferFromText([key, ...ptrs].join(' '), PROVIDER_PATTERNS);

    // 2) MaxMind ASN
    let asn: number | null = null;
    let asnOrg: string | null = null;
    if (mmdbReader && isIP(key)) {
      const mm = lookupMmdb(key);
      asn = mm.asn;
      asnOrg = mm.asnOrg;
      if (!provider && asnOrg) {
        provider = inferFromText(asnOrg, ASN_ORG_PATTERNS) || asnOrg;
      }
    }

    if (provider) {
      const info = makeInfo(provider, mmdbReader && asnOrg ? 'mmdb' : 'ptr', asn, asnOrg);
      setCached(key, info);
      return info;
    }

    // No provider yet — return unknown for now; ip-api batch can fill in via bulk path
    const info = makeInfo(UNKNOWN_PROVIDER, 'unknown', asn, asnOrg);
    setCached(key, info);
    return info;
  })().finally(() => pending.delete(key));

  pending.set(key, promise);
  return promise;
}

/**
 * Resolve providers for a list of hosts efficiently:
 *   - Hits cache + PTR + MaxMind first (parallel, up to 24 workers)
 *   - Then collects all still-Unknown public IPs and batches them through ip-api.com
 *     (max IP_API_MAX_BATCH_PER_CYCLE batches of 100 IPs to respect free-tier rate limits)
 *
 * Returns a Map keyed by the original host string (lowercased).
 */
export async function bulkResolveProviders(
  inputs: Array<{ host: string; isTor: boolean }>,
): Promise<Map<string, ProviderInfo>> {
  const out = new Map<string, ProviderInfo>();
  if (inputs.length === 0) return out;
  const uniqueInputs = Array.from(
    new Map(
      inputs.map((input) => {
        const key = String(input.host || '').trim().toLowerCase();
        return [key, { host: key, isTor: input.isTor }];
      }),
    ).values(),
  ).filter((entry) => entry.host.length > 0);
  if (uniqueInputs.length === 0) return out;

  // Stage 1: cache / PTR / MaxMind
  const concurrency = Math.min(24, uniqueInputs.length);
  let idx = 0;
  const worker = async () => {
    while (idx < uniqueInputs.length) {
      const cur = uniqueInputs[idx++];
      const info = await resolveProviderInfo(cur.host, cur.isTor);
      out.set(cur.host, info);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  // Stage 2: ip-api batch fallback for Unknown public IPs
  if (!config.providerLookup.ipApiEnabled || config.providerLookup.ipApiMaxBatchPerCycle <= 0) {
    return out;
  }

  const stillUnknown = uniqueInputs
    .filter((i) => !i.isTor && isIP(String(i.host || '').trim()))
    .map((i) => String(i.host).trim().toLowerCase())
    .filter((h) => {
      const info = out.get(h);
      return info && info.provider === UNKNOWN_PROVIDER;
    });

  if (stillUnknown.length === 0) return out;

  const uniq = Array.from(new Set(stillUnknown));
  const maxBatches = config.providerLookup.ipApiMaxBatchPerCycle;
  for (let b = 0; b < maxBatches && b * IP_API_BATCH_SIZE < uniq.length; b++) {
    const slice = uniq.slice(b * IP_API_BATCH_SIZE, (b + 1) * IP_API_BATCH_SIZE);
    const result = await ipApiBatch(slice);
    if (result.size === 0) break; // rate-limited or failed; stop trying this cycle
    for (const [ip, asnInfo] of result) {
      const key = ip.toLowerCase();
      const provider =
        inferFromText(asnInfo.asnOrg || '', ASN_ORG_PATTERNS) ||
        (asnInfo.asnOrg ? asnInfo.asnOrg : UNKNOWN_PROVIDER);
      const info = makeInfo(provider, 'ipapi', asnInfo.asn, asnInfo.asnOrg);
      setCached(key, info);
      out.set(key, info);
    }
  }

  return out;
}

export function clearProviderCache(): void {
  cache.clear();
  pending.clear();
  ipApiCallTimes = [];
  ipApiBackoffMs = 0;
  ipApiCooldownUntilMs = 0;
}

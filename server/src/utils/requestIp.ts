import { isIP } from 'node:net';
import type { Request } from 'express';

function normalizeIp(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}

function stripPort(ipOrHost: string): string {
  const value = ipOrHost.trim();
  if (!value) return '';

  // [ipv6]:port
  const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed?.[1]) {
    return bracketed[1];
  }

  // ipv4:port
  if (value.includes(':') && value.indexOf(':') === value.lastIndexOf(':')) {
    const [host] = value.split(':');
    if (host) return host;
  }

  return value;
}

export function parseForwardedIp(value: string): string | null {
  // X-Forwarded-For can contain a comma-separated chain.
  const first = value.split(',')[0]?.trim();
  if (!first) return null;

  const candidate = normalizeIp(stripPort(first));
  return isIP(candidate) ? candidate : null;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA fc00::/7
  if (normalized.startsWith('fe80:')) return true; // link-local
  return false;
}

export function isTrustedProxyPeer(rawIp: string): boolean {
  const normalized = normalizeIp(rawIp);
  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version === 6) return isPrivateIpv6(normalized);
  return false;
}

function readHeaderValue(req: Request, headerName: string): string | null {
  const raw = req.headers[headerName];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0] || null;
  return null;
}

export function resolveRequestIp(req: Request, preferredHeaders: string[]): string {
  const peerIp = normalizeIp(req.socket.remoteAddress || '');
  const trustForwardedHeaders = isTrustedProxyPeer(peerIp);

  if (trustForwardedHeaders) {
    for (const headerName of preferredHeaders) {
      const rawValue = readHeaderValue(req, headerName);
      if (!rawValue) continue;
      const parsed = parseForwardedIp(rawValue);
      if (parsed) return parsed;
    }
  }

  const fallback = normalizeIp(req.ip || peerIp || '');
  if (isIP(fallback)) return fallback;

  // Defense-in-depth: never return an unvalidated raw header/socket value as a
  // rate-limit bucket key. A malformed `X-Forwarded-For` could otherwise let
  // an attacker pivot to arbitrary buckets and bypass per-IP throttling.
  return 'unknown';
}

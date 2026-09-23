import type { RequestHandler } from 'express';
import { config } from '../config';

export type CachePolicyProfile = 'no-store' | 'short' | 'medium' | 'long';

type CacheProfileConfig = {
  maxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveProfile(profile: CachePolicyProfile): CacheProfileConfig {
  const baseShort = clamp(Math.floor(config.cache.ttlSeconds), 1, 20);

  if (profile === 'short') {
    return { maxAgeSeconds: baseShort, staleWhileRevalidateSeconds: baseShort };
  }

  if (profile === 'medium') {
    const ttl = clamp(baseShort * 6, 15, 120);
    return { maxAgeSeconds: ttl, staleWhileRevalidateSeconds: ttl };
  }

  if (profile === 'long') {
    const ttl = clamp(baseShort * 30, 60, 900);
    return { maxAgeSeconds: ttl, staleWhileRevalidateSeconds: ttl };
  }

  return { maxAgeSeconds: 0, staleWhileRevalidateSeconds: 0 };
}

export function applyCachePolicyHeaders(
  res: { setHeader: (name: string, value: string) => void },
  profile: CachePolicyProfile
): void {
  res.setHeader('X-Cache-Profile', profile);

  if (profile === 'no-store') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return;
  }

  const resolved = resolveProfile(profile);
  const browserPolicy = `private, max-age=${resolved.maxAgeSeconds}, stale-while-revalidate=${resolved.staleWhileRevalidateSeconds}`;
  const sharedPolicy = `public, max-age=${resolved.maxAgeSeconds}, stale-while-revalidate=${resolved.staleWhileRevalidateSeconds}`;

  // Browsers get a short private max-age; the CDN caches the same response
  // independently via (Cloudflare-)CDN-Cache-Control. A Cloudflare Browser
  // Cache TTL override replaces this max-age (only no-store/no-cache survive
  // it), so the zone must use "Respect Existing Headers".
  res.setHeader(
    'Cache-Control',
    browserPolicy
  );
  res.setHeader('CDN-Cache-Control', sharedPolicy);
  res.setHeader('Cloudflare-CDN-Cache-Control', sharedPolicy);
}

export function withCachePolicy(profile: CachePolicyProfile): RequestHandler {
  return (_req, res, next) => {
    applyCachePolicyHeaders(res, profile);
    next();
  };
}

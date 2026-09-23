export const SPA_SHELL_CACHE_TTL_MS = 5 * 60 * 1000;
export const SPA_SHELL_CACHE_MAX_ENTRIES = 128;
export const SPA_SHELL_RESPONSE_CACHE_CONTROL = 'no-cache, max-age=0, must-revalidate';

export type CachedSpaShell = {
  html: string;
  robots: string;
  cachedAtMs: number;
};

type RenderedSpaShell = Omit<CachedSpaShell, 'cachedAtMs'>;
type SpaShellRenderer = (indexHtml: string, pathname: string) => RenderedSpaShell;

export function normalizeSpaShellPath(pathname: string): string {
  const clean = (pathname || '/').split('?')[0] || '/';
  if (clean === '/') return '/';
  return clean.replace(/\/+$/, '') || '/';
}

/**
 * Small LRU cache for the SEO portion of SPA HTML. The boot payload is built
 * separately for every request, so cached shell markup never freezes live
 * dashboard data. Bounding the cache keeps arbitrary unknown paths from
 * growing process memory indefinitely.
 */
export class SpaShellCache {
  private readonly entries = new Map<string, CachedSpaShell>();
  private readonly maxEntries: number;

  constructor(
    private readonly ttlMs = SPA_SHELL_CACHE_TTL_MS,
    maxEntries = SPA_SHELL_CACHE_MAX_ENTRIES
  ) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  get(
    indexHtml: string,
    pathname: string,
    render: SpaShellRenderer,
    now = Date.now()
  ): CachedSpaShell {
    const key = normalizeSpaShellPath(pathname);
    const cached = this.entries.get(key);
    if (cached && now - cached.cachedAtMs < this.ttlMs) {
      // Re-inserting a hit moves it to the most-recently-used position.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }

    if (cached) this.entries.delete(key);
    const entry: CachedSpaShell = { ...render(indexHtml, key), cachedAtMs: now };
    this.entries.set(key, entry);

    while (this.entries.size > this.maxEntries) {
      const leastRecentlyUsedKey = this.entries.keys().next().value;
      if (leastRecentlyUsedKey == null) break;
      this.entries.delete(leastRecentlyUsedKey);
    }

    return entry;
  }

  get size(): number {
    return this.entries.size;
  }
}

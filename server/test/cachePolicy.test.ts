import { applyCachePolicyHeaders } from '../src/middleware/cachePolicy';

function responseHeaders(): { headers: Map<string, string>; setHeader: (name: string, value: string) => void } {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader: (name, value) => headers.set(name, value),
  };
}

describe('cache policy headers', () => {
  it('keeps short responses private in browsers and separately cacheable by CDNs', () => {
    const response = responseHeaders();

    applyCachePolicyHeaders(response, 'short');

    const browserPolicy = response.headers.get('Cache-Control');
    const cdnPolicy = response.headers.get('CDN-Cache-Control');
    expect(browserPolicy).toMatch(/^private, max-age=\d+, stale-while-revalidate=\d+$/);
    expect(cdnPolicy).toMatch(/^public, max-age=\d+, stale-while-revalidate=\d+$/);
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(cdnPolicy);
    expect(response.headers.get('X-Cache-Profile')).toBe('short');
  });

  it('does not allow no-store responses to be cached by browsers or CDNs', () => {
    const response = responseHeaders();

    applyCachePolicyHeaders(response, 'no-store');

    expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('Expires')).toBe('0');
    expect(response.headers.has('CDN-Cache-Control')).toBe(false);
    expect(response.headers.has('Cloudflare-CDN-Cache-Control')).toBe(false);
  });
});

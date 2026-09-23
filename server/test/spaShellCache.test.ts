import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeSpaShellPath,
  SPA_SHELL_RESPONSE_CACHE_CONTROL,
  SpaShellCache,
} from '../src/utils/spaShellCache';

const render = vi.fn((indexHtml: string, pathname: string) => ({
  html: `${indexHtml}:${pathname}`,
  robots: 'index, follow',
}));

describe('SpaShellCache', () => {
  beforeEach(() => {
    render.mockClear();
  });

  it('requires every cached shell response to revalidate', () => {
    expect(SPA_SHELL_RESPONSE_CACHE_CONTROL).toBe('no-cache, max-age=0, must-revalidate');
  });

  it('normalizes query strings and trailing slashes to one cache key', () => {
    const cache = new SpaShellCache();

    const first = cache.get('<html>', '/network/?source=menu', render, 1_000);
    const second = cache.get('<html>', '/network', render, 1_001);

    expect(normalizeSpaShellPath('/network/?source=menu')).toBe('/network');
    expect(first).toBe(second);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('renders again once a cached shell reaches its TTL', () => {
    const cache = new SpaShellCache(1_000);

    const first = cache.get('<html>', '/rewards', render, 1_000);
    const second = cache.get('<html>', '/rewards', render, 2_000);

    expect(first).not.toBe(second);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used path when it reaches its bound', () => {
    const cache = new SpaShellCache(10_000, 2);

    const first = cache.get('<html>', '/first', render, 1_000);
    cache.get('<html>', '/second', render, 1_001);
    cache.get('<html>', '/first', render, 1_002);
    cache.get('<html>', '/third', render, 1_003);
    const rerenderedSecond = cache.get('<html>', '/second', render, 1_004);

    expect(cache.size).toBe(2);
    expect(rerenderedSecond).not.toBe(first);
    expect(render).toHaveBeenCalledTimes(4);
  });
});

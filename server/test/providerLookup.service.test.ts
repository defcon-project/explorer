import { promises as dns } from 'dns';
import { config } from '../src/config';
import { clearProviderCache, resolveProviderInfo, bulkResolveProviders } from '../src/services/providerLookup.service';

vi.mock('dns', () => ({ promises: { reverse: vi.fn() } }));

describe('provider lookup resource use', () => {
  const ipApiEnabled = config.providerLookup.ipApiEnabled;
  beforeEach(() => {
    vi.useFakeTimers();
    clearProviderCache();
    config.providerLookup.ipApiEnabled = false;
  });
  afterEach(() => {
    config.providerLookup.ipApiEnabled = ipApiEnabled;
    vi.useRealTimers();
  });

  it('releases the timeout after successful DNS resolution and reuses cached results', async () => {
    vi.mocked(dns.reverse).mockResolvedValue(['host.hetzner.com']);
    expect((await resolveProviderInfo('198.51.100.1', false)).provider).toBe('Hetzner');
    expect(vi.getTimerCount()).toBe(0);
    await resolveProviderInfo('198.51.100.1', false);
    expect(dns.reverse).toHaveBeenCalledTimes(1);
  });

  it('releases the timeout on DNS failure', async () => {
    vi.mocked(dns.reverse).mockRejectedValue(new Error('DNS unavailable'));
    expect((await resolveProviderInfo('198.51.100.2', false)).provider).toBe('Unknown');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the DNS deadline and shares concurrent lookups', async () => {
    vi.mocked(dns.reverse).mockReturnValue(new Promise(() => {}));
    const first = resolveProviderInfo('198.51.100.3', false);
    const second = resolveProviderInfo('198.51.100.3', false);
    await vi.advanceTimersByTimeAsync(1200);
    expect((await first).provider).toBe('Unknown');
    expect(await second).toEqual(await first);
    expect(dns.reverse).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds retained hosts and recomputes an evicted provider without changing its result', async () => {
    vi.mocked(dns.reverse).mockResolvedValue(['host.hetzner.com']);
    await resolveProviderInfo('198.51.100.1', false);
    for (let i = 0; i < 4096; i += 1) {
      await resolveProviderInfo(`10.0.${Math.floor(i / 256)}.${i % 256}`, false);
    }
    expect(dns.reverse).toHaveBeenCalledTimes(4097);
    expect((await resolveProviderInfo('198.51.100.1', false)).provider).toBe('Hetzner');
    expect(dns.reverse).toHaveBeenCalledTimes(4098);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('normalizes and deduplicates bulk inputs while preserving Tor handling', async () => {
    vi.mocked(dns.reverse).mockResolvedValue(['host.hetzner.com']);
    const result = await bulkResolveProviders([
      { host: ' 198.51.100.4 ', isTor: false }, { host: '198.51.100.4', isTor: false },
      { host: 'test.onion', isTor: true }, { host: '', isTor: false },
    ]);
    expect([...result.keys()].sort()).toEqual(['198.51.100.4', 'test.onion']);
    expect(result.get('test.onion')?.provider).toBe('Tor');
    expect(dns.reverse).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

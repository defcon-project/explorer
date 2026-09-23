import {
  buildAddressDeltaPipeline,
  canApplyAddressDeltas,
  collectAddressDeltas,
  collectInvolvedAddresses,
  mergeAddressDeltas,
  normalizeSat,
} from '../src/services/sync/addressIndexing';

describe('address indexing domain', () => {
  it('validates whether transaction address deltas are safe to apply', () => {
    expect(canApplyAddressDeltas([{ txid: 'a' }], true)).toBe(true);
    expect(canApplyAddressDeltas([{ txid: 'a' }], false)).toBe(false);
    expect(
      canApplyAddressDeltas([{ txid: 'a', address: 'Daddr', valueSat: '1' }], false)
    ).toBe(true);
  });

  it('normalizes satoshi and coin values deterministically', () => {
    expect(normalizeSat('250')).toBe(250n);
    expect(normalizeSat('', 1.5)).toBe(150000000n);
    expect(normalizeSat(undefined, null)).toBe(0n);
  });

  it('collects unique involved addresses and signed balance deltas', () => {
    const vins = [{ txid: 'prev', address: 'Dsender', valueSat: '7' }];
    const vouts = [
      { valueSat: '4', scriptPubKey: { addresses: ['Dreceiver', 'Dsender'] } },
      { valueSat: '3', scriptPubKey: { addresses: ['Dreceiver'] } },
    ];

    expect(collectInvolvedAddresses(vins, vouts)).toEqual(['Dsender', 'Dreceiver']);
    expect(collectAddressDeltas(vins, vouts, false)).toEqual(
      new Map([
        ['Dreceiver', { receivedSat: 7n, sentSat: 0n }],
        ['Dsender', { receivedSat: 4n, sentSat: 7n }],
      ])
    );
  });

  it('merges per-transaction deltas for block-level bulk writes', () => {
    const target = new Map([['Daddr', { receivedSat: 2n, sentSat: 1n }]]);
    mergeAddressDeltas(
      target,
      new Map([
        ['Daddr', { receivedSat: 3n, sentSat: 4n }],
        ['Dnew', { receivedSat: 5n, sentSat: 0n }],
      ])
    );

    expect(target).toEqual(
      new Map([
        ['Daddr', { receivedSat: 5n, sentSat: 5n }],
        ['Dnew', { receivedSat: 5n, sentSat: 0n }],
      ])
    );
  });

  it('builds the atomic MongoDB update pipeline used by live sync and rebuilds', () => {
    const pipeline = buildAddressDeltaPipeline(
      'Dabc',
      { receivedSat: 11n, sentSat: 3n },
      1700000000
    );
    const setStage = (pipeline[0] as { $set?: Record<string, unknown> }).$set;

    expect(pipeline).toHaveLength(1);
    expect(setStage).toBeDefined();
    expect((setStage?.address as { $ifNull: [string, string] }).$ifNull[1]).toBe('Dabc');
    expect((setStage?.txCount as { $add: [number, number] }).$add[1]).toBe(1);
  });
});

import {
  coinToSat,
  normalizeAddressAmounts,
  normalizeBlockAmounts,
  normalizeTransactionAmounts,
  satToBigInt,
  satToCoin,
} from '../src/utils/amounts';
import { logger } from '../src/utils/logger';

const DONATION_ADDRESS = 'D9uqHkeoqWDQ6CZS7BekgdVozuJ33yYFby';

describe('amount conversion utils', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses bigint/number/string/object sat formats', () => {
    expect(satToBigInt(42n)).toBe(42n);
    expect(satToBigInt(7)).toBe(7n);
    expect(satToBigInt('123')).toBe(123n);
    expect(satToBigInt('12.99')).toBe(12n);
    expect(satToBigInt({ toString: () => '500' })).toBe(500n);
    expect(satToBigInt(undefined)).toBe(0n);
  });

  it('warns for non-finite and unsafe numeric inputs', () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger as never);

    expect(satToBigInt(Number.NaN)).toBe(0n);
    expect(satToBigInt(Number.POSITIVE_INFINITY)).toBe(0n);
    expect(satToBigInt(Number.MAX_SAFE_INTEGER + 10)).toBe(BigInt(Math.trunc(Number.MAX_SAFE_INTEGER + 10)));
    expect(warnSpy).toHaveBeenCalled();
  });

  it('converts between coin and sat values', () => {
    const sat = coinToSat(1.23456789);
    expect(sat).toBe(123456789n);
    expect(satToCoin(sat)).toBeCloseTo(1.23456789, 8);
    expect(coinToSat(null)).toBe(0n);
  });

  it('normalizes address and block amount payloads', () => {
    const address = {
      balanceSat: '150000000',
      totalReceivedSat: 300000000n,
      totalSentSat: 50000000,
    };
    const block = {
      rewardSat: '200000000',
      totalValueOutSat: 350000000,
    };

    const normalizedAddress = normalizeAddressAmounts(address);
    const normalizedBlock = normalizeBlockAmounts(block);

    expect(normalizedAddress).toBe(address);
    expect(normalizedAddress).toMatchObject({
      balanceSat: '150000000',
      totalReceivedSat: '300000000',
      totalSentSat: '50000000',
      balance: 1.5,
      totalReceived: 3,
      totalSent: 0.5,
    });

    expect(normalizedBlock).toBe(block);
    expect(normalizedBlock).toMatchObject({
      rewardSat: '200000000',
      totalValueOutSat: '350000000',
      reward: 2,
      totalValueOut: 3.5,
    });
  });

  it('normalizes transaction values and marks donation tx', () => {
    const tx = {
      vin: [{ valueSat: '25000000' }],
      vout: [
        { valueSat: '100000000', scriptPubKey: { addresses: [DONATION_ADDRESS] } },
        { valueSat: 50000000, scriptPubKey: { addresses: ['DNoDonationAddress'] } },
      ],
      totalValueInSat: '25000000',
      totalValueOutSat: '150000000',
      feeSat: '1000000',
    };

    const normalized = normalizeTransactionAmounts(tx);

    expect(normalized).toBe(tx);
    expect(normalized.vin[0]).toMatchObject({ valueSat: '25000000', value: 0.25 });
    expect(normalized.vout[0]).toMatchObject({ valueSat: '100000000', value: 1 });
    expect(normalized.vout[1]).toMatchObject({ valueSat: '50000000', value: 0.5 });
    expect(normalized).toMatchObject({
      totalValueInSat: '25000000',
      totalValueOutSat: '150000000',
      feeSat: '1000000',
      totalValueIn: 0.25,
      totalValueOut: 1.5,
      fee: 0.01,
      donationAmount: 1,
      isDonation: true,
    });
  });
});


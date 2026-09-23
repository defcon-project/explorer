import { COIN } from '@defcon/shared';
import { logger } from './logger';

const SAT_MULTIPLIER = 10n ** BigInt(COIN.DECIMALS);
const FRACTION_DIGITS = COIN.DECIMALS;
const DONATION_ADDRESS = 'D9uqHkeoqWDQ6CZS7BekgdVozuJ33yYFby';

export type SatLike = number | string | bigint | { toString(): string } | null | undefined;

function parseDecimalLikeToBigInt(raw: string): bigint {
  const normalized = raw.trim();
  if (!normalized) return 0n;

  const match = normalized.match(/^([+-])?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return 0n;

  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = match[2] || '0';
  const fractionPart = match[3] || '';
  const exponent = Number(match[4] || '0');
  if (!Number.isFinite(exponent) || !Number.isInteger(exponent)) return 0n;

  const digits = `${intPart}${fractionPart}`.replace(/^0+/, '') || '0';
  const scale = fractionPart.length - exponent;

  if (scale <= 0) {
    return sign * BigInt(digits + '0'.repeat(-scale));
  }

  if (digits.length <= scale) return 0n;
  return sign * BigInt(digits.slice(0, digits.length - scale));
}

function parseCoinLikeToSatBigInt(raw: string, decimals: number): bigint {
  const normalized = raw.trim();
  if (!normalized) return 0n;

  const match = normalized.match(/^([+-])?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return 0n;

  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = match[2] || '0';
  const fractionPart = match[3] || '';
  const exponent = Number(match[4] || '0');
  if (!Number.isFinite(exponent) || !Number.isInteger(exponent)) return 0n;

  const digits = `${intPart}${fractionPart}`.replace(/^0+/, '') || '0';
  if (digits === '0') return 0n;

  const scale = fractionPart.length - exponent;
  const shift = decimals - scale;

  if (shift >= 0) {
    return sign * BigInt(digits + '0'.repeat(shift));
  }

  const divisor = 10n ** BigInt(-shift);
  return sign * (BigInt(digits) / divisor);
}

export function satToBigInt(amountSat: SatLike): bigint {
  if (typeof amountSat === 'bigint') return amountSat;

  if (typeof amountSat === 'number') {
    if (!Number.isFinite(amountSat)) {
      logger.warn(`satToBigInt: non-finite number received (${amountSat}), returning 0`);
      return 0n;
    }
    if (!Number.isSafeInteger(amountSat)) {
      logger.warn(`satToBigInt: unsafe integer ${amountSat}, precision may be lost`);
    }
    return BigInt(Math.trunc(amountSat));
  }

  if (typeof amountSat === 'string') {
    const normalized = amountSat.trim();
    if (!normalized) return 0n;
    if (/^-?\d+$/.test(normalized)) {
      try {
        return BigInt(normalized);
      } catch {
        return 0n;
      }
    }
    return parseDecimalLikeToBigInt(normalized);
  }

  // Decimal128 and similar objects — convert via toString, non-recursive
  if (amountSat && typeof amountSat === 'object' && typeof amountSat.toString === 'function') {
    const str = amountSat.toString();
    if (typeof str === 'string') {
      const normalized = str.trim();
      if (!normalized) return 0n;
      if (/^-?\d+$/.test(normalized)) {
        try { return BigInt(normalized); } catch { return 0n; }
      }
      return parseDecimalLikeToBigInt(normalized);
    }
  }

  return 0n;
}

export function satToString(amountSat: SatLike): string {
  return satToBigInt(amountSat).toString();
}

export function satToCoin(amountSat: SatLike): number {
  const sat = satToBigInt(amountSat);
  const negative = sat < 0n;
  const absSat = negative ? -sat : sat;
  const whole = absSat / SAT_MULTIPLIER;
  const fraction = absSat % SAT_MULTIPLIER;

  const decimal = `${negative ? '-' : ''}${whole.toString()}.${fraction
    .toString()
    .padStart(FRACTION_DIGITS, '0')}`;

  const parsed = Number(decimal);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function coinToSat(amountCoin?: number | null): bigint {
  if (typeof amountCoin !== 'number' || !Number.isFinite(amountCoin)) return 0n;
  return parseCoinLikeToSatBigInt(amountCoin.toString(), FRACTION_DIGITS);
}

export function coinAmount(amountSat: SatLike): number {
  return satToCoin(amountSat);
}

export function normalizeAddressAmounts<T extends Record<string, unknown>>(address: T): T {
  if (!address) return address;

  // Mutate lean() object in-place
  const out = address as Record<string, unknown>;
  out.balanceSat = satToString(out.balanceSat as SatLike);
  out.totalReceivedSat = satToString(out.totalReceivedSat as SatLike);
  out.totalSentSat = satToString(out.totalSentSat as SatLike);
  out.balance = coinAmount(out.balanceSat as string);
  out.totalReceived = coinAmount(out.totalReceivedSat as string);
  out.totalSent = coinAmount(out.totalSentSat as string);
  return address;
}

export function normalizeBlockAmounts<T extends Record<string, unknown>>(block: T): T {
  if (!block) return block;

  // Mutate lean() object in-place
  const out = block as Record<string, unknown>;
  out.rewardSat = satToString(out.rewardSat as SatLike);
  out.totalValueOutSat = satToString(out.totalValueOutSat as SatLike);
  out.reward = coinAmount(out.rewardSat as string);
  out.totalValueOut = coinAmount(out.totalValueOutSat as string);
  return block;
}

interface NormalizeTransactionOptions {
  maxVoutAddresses?: number;
}

export function normalizeTransactionAmounts<T extends Record<string, unknown>>(
  tx: T,
  options: NormalizeTransactionOptions = {}
): T {
  if (!tx) return tx;

  // Mutate lean() object in-place to avoid expensive spread copies
  const out = tx as Record<string, unknown>;
  const maxVoutAddresses =
    typeof options.maxVoutAddresses === 'number' && options.maxVoutAddresses > 0
      ? Math.floor(options.maxVoutAddresses)
      : null;

  let donationAmountSat = 0n;
  let isDonation = false;
  if (Array.isArray(out.vout)) {
    for (const output of out.vout as Array<Record<string, unknown>>) {
      const addresses = (output.scriptPubKey as { addresses?: unknown } | undefined)?.addresses;
      if (Array.isArray(addresses) && addresses.includes(DONATION_ADDRESS)) {
        isDonation = true;
        donationAmountSat += satToBigInt(output.valueSat as SatLike);
      }
      if (maxVoutAddresses != null && Array.isArray(addresses) && addresses.length > maxVoutAddresses) {
        (output.scriptPubKey as { addresses?: string[] }).addresses = addresses
          .slice(0, maxVoutAddresses)
          .map((address) => String(address));
      }
      output.valueSat = satToString(output.valueSat as SatLike);
      output.value = coinAmount(output.valueSat as string);
    }
  }

  if (Array.isArray(out.vin)) {
    for (const input of out.vin as Array<Record<string, unknown>>) {
      input.valueSat = satToString(input.valueSat as SatLike);
      input.value = coinAmount(input.valueSat as string);
    }
  }

  out.totalValueInSat = satToString(out.totalValueInSat as SatLike);
  out.totalValueOutSat = satToString(out.totalValueOutSat as SatLike);
  out.feeSat = satToString(out.feeSat as SatLike);
  out.totalValueIn = coinAmount(out.totalValueInSat as string);
  out.totalValueOut = coinAmount(out.totalValueOutSat as string);
  out.fee = coinAmount(out.feeSat as string);
  out.donationAmount = satToCoin(donationAmountSat);
  out.isDonation = isDonation;

  return tx;
}

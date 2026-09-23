// Cache Intl.NumberFormat instances — creating them is expensive
const numberFormatCache = new Map<number, Intl.NumberFormat>();

function getNumberFormat(decimals: number): Intl.NumberFormat {
  let fmt = numberFormatCache.get(decimals);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormatCache.set(decimals, fmt);
  }
  return fmt;
}

export function formatNumber(num: number, decimals = 0): string {
  return getNumberFormat(decimals).format(num);
}

export function formatHashrate(hashrate: number): string {
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
  let unitIndex = 0;
  let value = hashrate;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

export function formatDifficulty(diff: number): string {
  if (diff >= 1e12) return `${(diff / 1e12).toFixed(2)}T`;
  if (diff >= 1e9) return `${(diff / 1e9).toFixed(2)}G`;
  if (diff >= 1e6) return `${(diff / 1e6).toFixed(2)}M`;
  if (diff >= 1e3) return `${(diff / 1e3).toFixed(2)}K`;
  return diff.toFixed(2);
}

export function truncateHash(hash: string, chars = 8): string {
  if (hash.length <= chars * 2 + 3) return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}

export function formatCoin(amount: number): string {
  return formatNumber(amount, 8).replace(/\.?0+$/, '');
}

export function formatAge(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

/**
 * Format a very small price (e.g. 0.00001006 or 0.0000000001) with enough
 * decimal places to always show at least `sigFigs` significant figures.
 */
export function formatSmallPrice(price: number, sigFigs = 4): string {
  if (!Number.isFinite(price) || price === 0) return '0';
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // leading zeros after the decimal point, e.g. 0.00001006 → 4 leading zeros
  const leadingZeros = Math.max(0, -Math.floor(Math.log10(Math.abs(price))) - 1);
  const decimals = leadingZeros + sigFigs;
  return price.toFixed(decimals);
}

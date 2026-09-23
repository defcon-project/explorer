export const COIN = {
  NAME: 'DeFCoN',
  TICKER: 'DFCN',
  ADDRESS_PREFIX: 'D',
  DECIMALS: 8,
  MAX_SUPPLY: null, // Uncapped: fixed per-block emission, no hard cap
  BLOCK_TIME_SECONDS: 150,
  INITIAL_REWARD: 10000, // Fixed per-block masternode payment (DFCN); the stake reward is on top
  HALVING_INTERVAL: 0, // No halving schedule
  GENESIS_BLOCK_HASH: '',
  DEFAULT_RPC_PORT: 8193,
  DEFAULT_P2P_PORT: 8192,
  MASTERNODE_COLLATERAL: 1000000,
} as const;

export function satoshiToCoin(satoshi: number): number {
  return satoshi / 1e8;
}

export function coinToSatoshi(coin: number): number {
  return Math.round(coin * 1e8);
}

export function formatCoin(amount: number, decimals = 8): string {
  return amount.toFixed(decimals).replace(/\.?0+$/, '');
}

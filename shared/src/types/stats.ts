export interface IStats {
  blockHeight: number;
  difficulty: number;
  hashrate: number;
  connections: number;
  mempool: {
    size: number;
    bytes: number;
  };
  supply: {
    circulating: number;
    max: number | null; // null indicates dynamic supply managed by DAO
  };
  blockReward: number;
  stakingReward?: number;
  avgBlockTime: number;
  txCount24h: number;
  txCount30d?: number;
  avgTxPerBlock30d?: number;
  txTrend30d?: Array<{
    date: string;
    count: number;
  }>;
  newAddresses24h?: number;
  newAddresses7d?: number;
  masternodes?: number; // Active masternodes (PoS2)
  stakingWallets?: number; // Active staking wallets (PoS)
  price?: {
    usd: number;
    btc: number;
    change24h: number;
  };
}

export interface IStatsHistory {
  timestamp: number;
  difficulty: number;
  hashrate: number;
  blockHeight: number;
  txCount: number;
}

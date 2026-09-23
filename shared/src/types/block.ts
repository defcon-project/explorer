export interface IBlock {
  hash: string;
  height: number;
  confirmations: number;
  size: number;
  version: number;
  merkleroot: string;
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  previousblockhash?: string;
  nextblockhash?: string;
  minedBy?: string;
  rewardSat: number | string;
  totalValueOutSat: number | string;
  txids: string[];
  // Derived coin-denominated fields for API responses.
  reward?: number;
  totalValueOut?: number;
}

export interface RpcVin {
  txid?: string;
  vout?: number;
  scriptSig?: { asm: string; hex: string };
  coinbase?: string;
  sequence: number;
  value?: number;
  valueSat?: number;
  address?: string;
}

export interface RpcVout {
  value: number;
  valueSat?: number;
  n: number;
  scriptPubKey: {
    asm: string;
    hex: string;
    reqSigs?: number;
    type: string;
    address?: string;
    addresses?: string[];
  };
}

export interface RpcTransaction {
  txid: string;
  version: number;
  size: number;
  locktime: number;
  vin: RpcVin[];
  vout: RpcVout[];
}

export interface RpcBlock {
  hash: string;
  confirmations: number;
  size: number;
  height: number;
  version: number;
  merkleroot: string;
  tx: Array<RpcTransaction | string>;
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  mint?: number;
  moneysupply?: number;
  chainwork: string;
  nTx: number;
  previousblockhash?: string;
  nextblockhash?: string;
}

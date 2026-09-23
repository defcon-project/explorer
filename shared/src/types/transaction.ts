export interface IVin {
  txid?: string;
  vout?: number;
  scriptSig?: {
    asm: string;
    hex: string;
  };
  coinbase?: string;
  sequence: number;
  valueSat?: number | string;
  address?: string;
  // Derived coin-denominated field for API responses.
  value?: number;
}

export interface IVout {
  value?: number;
  valueSat: number | string;
  n: number;
  scriptPubKey: {
    asm: string;
    hex: string;
    reqSigs?: number;
    type: string;
    addresses?: string[];
  };
}

export interface ITransaction {
  txid: string;
  blockhash: string;
  blockheight: number;
  blocktime: number;
  version: number;
  size: number;
  locktime: number;
  vin: IVin[];
  vout: IVout[];
  totalValueInSat: number | string;
  totalValueOutSat: number | string;
  feeSat: number | string;
  isCoinbase: boolean;
  confirmations: number;
  // Derived coin-denominated fields for API responses.
  totalValueIn?: number;
  totalValueOut?: number;
  fee?: number;
}

export interface IAddress {
  address: string;
  balanceSat: number | string;
  totalReceivedSat: number | string;
  totalSentSat: number | string;
  txCount: number;
  firstSeen: number;
  lastSeen: number;
  // Derived coin-denominated fields for API responses.
  balance?: number;
  totalReceived?: number;
  totalSent?: number;
}

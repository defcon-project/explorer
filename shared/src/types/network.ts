export interface IPeer {
  addr: string;
  addrlocal?: string;
  services: string;
  version: number;
  subver: string;
  inbound: boolean;
  startingheight: number;
  synced_headers: number;
  synced_blocks: number;
  conntime: number;
  pingtime?: number;
  country?: string;
  city?: string;
  lat?: number;
  lon?: number;
}

export interface INetworkInfo {
  version: number;
  subversion: string;
  protocolversion: number;
  connections: number;
  networks: Array<{
    name: string;
    limited: boolean;
    reachable: boolean;
  }>;
}

import axios from 'axios';
import { config } from '../src/config';
import { NodeInventory } from '../src/models/NodeInventory';
import { NodeInventoryEvent } from '../src/models/NodeInventoryEvent';
import { getEnrichedNodes } from '../src/services/masternode.service';
import { nodeInventoryService } from '../src/services/nodeInventory.service';
import { rpcService } from '../src/services/rpc.service';
import { seedNodeService } from '../src/services/seedNode.service';
import { logger } from '../src/utils/logger';

vi.mock('../src/services/masternode.service', () => ({
  getEnrichedNodes: vi.fn(),
  parseService: vi.fn(),
}));

const DNS_SEEDER_FEED_URL = 'https://seeder.example.com/nodes';
const TEST_NODES_FEED_URL = 'https://seeder.example.com/fullnodes';

type BulkUpdate = { updateOne: { filter: { nodeKey: string } } };

describe('node inventory scanner external feeds', () => {
  const originalFeeds = {
    dnsSeederApiUrl: config.nodeInventory.dnsSeederApiUrl,
    preReleaseNodesApiUrl: config.nodeInventory.preReleaseNodesApiUrl,
    preReleaseNodesApiKey: config.nodeInventory.preReleaseNodesApiKey,
  };

  let bulkWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(getEnrichedNodes).mockResolvedValue([]);
    vi.spyOn(seedNodeService, 'getReport').mockReturnValue([]);
    vi.spyOn(rpcService, 'getBlockchainInfo').mockResolvedValue({ blocks: 150_000, bestblockhash: 'a'.repeat(64) });
    vi.spyOn(rpcService, 'getPeerInfo').mockResolvedValue([
      { addr: '203.0.113.20:8192', subver: '/DeFCoN Core:23.0.0/', version: 70242, synced_blocks: 150_000 },
    ]);
    vi.spyOn(NodeInventory, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) } as never);
    bulkWrite = vi.spyOn(NodeInventory, 'bulkWrite').mockResolvedValue({} as never);
    vi.spyOn(NodeInventoryEvent, 'insertMany').mockResolvedValue([] as never);
  });

  afterEach(() => {
    Object.assign(config.nodeInventory, originalFeeds);
    vi.restoreAllMocks();
  });

  function storedNodeKeys(): string[] {
    const updates = bulkWrite.mock.calls[0]?.[0] as BulkUpdate[] | undefined;
    return (updates ?? []).map((update) => update.updateOne.filter.nodeKey).sort();
  }

  it('skips disabled feeds without polling or logging them', async () => {
    Object.assign(config.nodeInventory, { dnsSeederApiUrl: '', preReleaseNodesApiUrl: '', preReleaseNodesApiKey: '' });
    const axiosGet = vi.spyOn(axios, 'get');
    const logError = vi.spyOn(logger, 'error');
    const logDebug = vi.spyOn(logger, 'debug');

    await nodeInventoryService.poll();

    expect(axiosGet).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(logDebug).not.toHaveBeenCalledWith(expect.stringMatching(/source unavailable/));
    expect(storedNodeKeys()).toEqual(['203.0.113.20:8192']);
  });

  it('merges rows from configured feeds and authenticates the test node feed', async () => {
    Object.assign(config.nodeInventory, {
      dnsSeederApiUrl: DNS_SEEDER_FEED_URL,
      preReleaseNodesApiUrl: TEST_NODES_FEED_URL,
      preReleaseNodesApiKey: 'feed-key',
    });
    const axiosGet = vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url === DNS_SEEDER_FEED_URL) {
        return { data: [{ ip: '198.51.100.5', port: 8192, version: '23.0.0' }] };
      }
      return { data: { nodes: [{ ip: '203.0.113.10', port: 8192, node_name: 'test-node-a', version: '23.0.0' }] } };
    });

    await nodeInventoryService.poll();

    expect(axiosGet).toHaveBeenCalledWith(DNS_SEEDER_FEED_URL, expect.objectContaining({ headers: undefined }));
    expect(axiosGet).toHaveBeenCalledWith(
      TEST_NODES_FEED_URL,
      expect.objectContaining({ headers: { 'X-API-Key': 'feed-key' } })
    );
    expect(storedNodeKeys()).toEqual(['198.51.100.5:8192', '203.0.113.10:8192', '203.0.113.20:8192']);
  });
});

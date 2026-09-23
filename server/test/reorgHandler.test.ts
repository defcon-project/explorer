import { config } from '../src/config';
import { Block } from '../src/models/Block';
import { SyncState } from '../src/models/SyncState';
import { Transaction } from '../src/models/Transaction';
import { ReorgHandler } from '../src/services/reorgHandler';
import { rpcService } from '../src/services/rpc.service';

function mockLeanQuery<T>(value: T) {
  return {
    lean: jest.fn().mockResolvedValue(value),
  };
}

function mockSortedSelectLeanQuery<T>(value: T) {
  const query = {
    sort: jest.fn(),
    select: jest.fn(),
    lean: jest.fn().mockResolvedValue(value),
  };
  query.sort.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe('ReorgHandler', () => {
  const originalReorgDepth = config.sync.reorgMaxDepth;

  afterEach(() => {
    jest.restoreAllMocks();
    config.sync.reorgMaxDepth = originalReorgDepth;
  });

  it('returns last height when no reorg is detected', async () => {
    const rebuildAddressIndex = jest.fn().mockResolvedValue(undefined);
    const handler = new ReorgHandler(rebuildAddressIndex);

    jest.spyOn(Block, 'findOne').mockImplementation((query: unknown) => {
      const q = query as { height?: number };
      if (q.height === 120) {
        return mockLeanQuery({ height: 120, hash: 'h120' }) as never;
      }
      throw new Error('Unexpected Block.findOne call');
    });
    jest.spyOn(rpcService, 'getBlockHash').mockResolvedValue('h120');

    const result = await handler.checkForReorg(120);

    expect(result).toBe(120);
    expect(rebuildAddressIndex).not.toHaveBeenCalled();
  });

  it('corrects sync state when last synced block is missing locally', async () => {
    const rebuildAddressIndex = jest.fn().mockResolvedValue(undefined);
    const handler = new ReorgHandler(rebuildAddressIndex);

    jest.spyOn(Block, 'findOne').mockImplementation((query: unknown) => {
      const q = query as Record<string, unknown>;
      if (q.height === 80) {
        return mockLeanQuery(null) as never;
      }
      if (Object.keys(q).length === 0) {
        return mockSortedSelectLeanQuery({ height: 77, hash: 'tip-77' }) as never;
      }
      throw new Error('Unexpected Block.findOne call');
    });
    const syncUpdateSpy = jest.spyOn(SyncState, 'findOneAndUpdate').mockResolvedValue({} as never);

    const result = await handler.checkForReorg(80);

    expect(result).toBe(77);
    expect(syncUpdateSpy).toHaveBeenCalledWith(
      { key: 'main' },
      expect.objectContaining({
        lastSyncedHeight: 77,
        lastSyncedHash: 'tip-77',
        addressRebuildRequired: true,
      }),
      { upsert: true }
    );
    expect(rebuildAddressIndex).not.toHaveBeenCalled();
  });

  it('rolls back to fork point and rebuilds address index on hash mismatch', async () => {
    const rebuildAddressIndex = jest.fn().mockResolvedValue(undefined);
    const handler = new ReorgHandler(rebuildAddressIndex);

    jest.spyOn(Block, 'findOne').mockImplementation((query: unknown) => {
      const q = query as Record<string, unknown>;
      if (q.height === 100) {
        return mockLeanQuery({ height: 100, hash: 'old-100' }) as never;
      }
      if (q.height === 99) {
        return mockLeanQuery({ height: 99, hash: 'common-99' }) as never;
      }
      if (Object.keys(q).length === 0) {
        return mockSortedSelectLeanQuery({ height: 99, hash: 'common-99' }) as never;
      }
      throw new Error('Unexpected Block.findOne call');
    });

    jest.spyOn(rpcService, 'getBlockHash').mockImplementation(async (height: number) => {
      if (height === 100) return 'new-100';
      if (height === 99) return 'common-99';
      return '';
    });

    const txDeleteSpy = jest
      .spyOn(Transaction, 'deleteMany')
      .mockResolvedValue({ deletedCount: 12 } as never);
    const blockDeleteSpy = jest
      .spyOn(Block, 'deleteMany')
      .mockResolvedValue({ deletedCount: 1 } as never);
    const syncUpdateSpy = jest.spyOn(SyncState, 'findOneAndUpdate').mockResolvedValue({} as never);

    const result = await handler.checkForReorg(100);

    expect(result).toBe(99);
    expect(txDeleteSpy).toHaveBeenCalledWith({ blockheight: { $gt: 99 } });
    expect(blockDeleteSpy).toHaveBeenCalledWith({ height: { $gt: 99 } });
    expect(rebuildAddressIndex).toHaveBeenCalledTimes(1);
    expect(syncUpdateSpy).toHaveBeenCalledWith(
      { key: 'main' },
      expect.objectContaining({
        lastSyncedHeight: 99,
        lastSyncedHash: 'common-99',
        addressRebuildRequired: true,
      }),
      { upsert: true }
    );
    expect(syncUpdateSpy).toHaveBeenLastCalledWith(
      { key: 'main' },
      expect.objectContaining({
        addressRebuildRequired: false,
      }),
      { upsert: true }
    );
  });

  it('keeps the rebuild-required marker when address recovery fails', async () => {
    const rebuildAddressIndex = jest.fn().mockRejectedValue(new Error('rebuild failed'));
    const handler = new ReorgHandler(rebuildAddressIndex);

    jest.spyOn(Block, 'findOne').mockImplementation((query: unknown) => {
      const q = query as Record<string, unknown>;
      if (q.height === 100) return mockLeanQuery({ height: 100, hash: 'old-100' }) as never;
      if (q.height === 99) return mockLeanQuery({ height: 99, hash: 'common-99' }) as never;
      if (Object.keys(q).length === 0) {
        return mockSortedSelectLeanQuery({ height: 99, hash: 'common-99' }) as never;
      }
      throw new Error('Unexpected Block.findOne call');
    });
    jest.spyOn(rpcService, 'getBlockHash').mockImplementation(async (height: number) =>
      height === 100 ? 'new-100' : 'common-99'
    );
    jest.spyOn(Transaction, 'deleteMany').mockResolvedValue({ deletedCount: 1 } as never);
    jest.spyOn(Block, 'deleteMany').mockResolvedValue({ deletedCount: 1 } as never);
    const syncUpdateSpy = jest.spyOn(SyncState, 'findOneAndUpdate').mockResolvedValue({} as never);

    await expect(handler.checkForReorg(100)).rejects.toThrow('rebuild failed');
    expect(syncUpdateSpy).toHaveBeenCalledWith(
      { key: 'main' },
      expect.objectContaining({ addressRebuildRequired: true }),
      { upsert: true }
    );
    expect(
      syncUpdateSpy.mock.calls.some(
        (call) =>
          (call[1] as { addressRebuildRequired?: boolean }).addressRebuildRequired === false
      )
    ).toBe(false);
  });

  it('throws when reorg depth exceeds configured max depth', async () => {
    config.sync.reorgMaxDepth = 1;

    const rebuildAddressIndex = jest.fn().mockResolvedValue(undefined);
    const handler = new ReorgHandler(rebuildAddressIndex);

    jest.spyOn(Block, 'findOne').mockImplementation((query: unknown) => {
      const q = query as { height?: number };
      if (q.height === 50) {
        return mockLeanQuery({ height: 50, hash: 'old-50' }) as never;
      }
      if (q.height === 49) {
        return mockLeanQuery({ height: 49, hash: 'old-49' }) as never;
      }
      throw new Error('Unexpected Block.findOne call');
    });

    jest.spyOn(rpcService, 'getBlockHash').mockImplementation(async (height: number) => {
      if (height === 50) return 'new-50';
      if (height === 49) return 'new-49';
      return '';
    });

    await expect(handler.checkForReorg(50)).rejects.toThrow(
      'Reorg depth exceeded configured limit (1). Manual intervention required.'
    );
    expect(rebuildAddressIndex).not.toHaveBeenCalled();
  });
});

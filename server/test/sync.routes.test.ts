import express from 'express';
import request from 'supertest';
import syncRoutes from '../src/routes/sync.routes';
import { SyncState } from '../src/models/SyncState';
import { Block } from '../src/models/Block';
import { Transaction } from '../src/models/Transaction';
import { Address } from '../src/models/Address';
import { rpcService } from '../src/services/rpc.service';

function mockSyncStateDoc() {
  jest.spyOn(SyncState, 'findOne').mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      key: 'main',
      isRunning: false,
      startedAt: null,
      heartbeatAt: null,
      addressRebuildRequired: false,
      satoshiDataVersion: 3,
      lastSyncedHeight: 150,
      lastSyncedHash: '000000abc',
      lastSyncedAt: new Date('2026-02-19T00:00:00Z'),
      error: null,
    }),
  } as never);
}

function mockSyncStateDocWithError(errorMessage: string) {
  jest.spyOn(SyncState, 'findOne').mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      key: 'main',
      isRunning: true,
      lastSyncedHeight: 150,
      error: errorMessage,
    }),
  } as never);
}

describe('sync routes', () => {
  const app = express();
  app.use('/api/sync', syncRoutes);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GET /api/sync returns computed sync status snapshot', async () => {
    mockSyncStateDoc();
    jest.spyOn(rpcService, 'getBlockCount').mockResolvedValue(200);
    jest.spyOn(Block, 'estimatedDocumentCount').mockResolvedValue(151);
    jest.spyOn(Transaction, 'estimatedDocumentCount').mockResolvedValue(5000);
    jest.spyOn(Address, 'estimatedDocumentCount').mockResolvedValue(1234);

    const res = await request(app).get('/api/sync');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      isRunning: false,
      lastSyncedHeight: 150,
      daemonHeight: 200,
      rpcConnected: true,
      blocksRemaining: 50,
      progress: 75.12,
      error: null,
      errorCode: null,
    });
    expect(res.body.data.startedAt).toBeUndefined();
    expect(res.body.data.lastSyncedHash).toBeUndefined();
    expect(res.body.data.dbStats).toBeUndefined();
  });

  it('GET /api/sync sanitizes internal sync error messages', async () => {
    mockSyncStateDocWithError('MongoServerError: connection lost to cluster');
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    jest.spyOn(rpcService, 'getBlockCount').mockResolvedValue(200);
    jest.spyOn(Block, 'estimatedDocumentCount').mockResolvedValue(151);
    jest.spyOn(Transaction, 'estimatedDocumentCount').mockResolvedValue(5000);
    jest.spyOn(Address, 'estimatedDocumentCount').mockResolvedValue(1234);

    const res = await request(app).get('/api/sync');

    expect(res.status).toBe(200);
    expect(res.body.data.error).toBe('Sync failed. Check server logs.');
    expect(res.body.data.errorCode).toBe('SYNC_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('MongoServerError');
  });
});

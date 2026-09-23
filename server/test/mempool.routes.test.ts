import express from 'express';
import request from 'supertest';
import mempoolRoutes from '../src/routes/mempool.routes';
import { rpcService } from '../src/services/rpc.service';

describe('mempool routes', () => {
  const app = express();
  app.use('/api/mempool', mempoolRoutes);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GET /api/mempool returns 400 for invalid limit', async () => {
    const res = await request(app).get('/api/mempool').query({ limit: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('GET /api/mempool returns 503 when RPC fails', async () => {
    jest.spyOn(rpcService, 'getMempoolInfo').mockRejectedValue(new Error('rpc down'));
    jest.spyOn(rpcService, 'getRawMemPool').mockResolvedValue([]);

    const res = await request(app).get('/api/mempool').query({ limit: 6 });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
  });

  it('GET /api/mempool returns mempool info with sampled tx data', async () => {
    jest.spyOn(rpcService, 'getMempoolInfo').mockResolvedValue({
      size: 2,
      bytes: 1234,
      usage: 2048,
    });
    jest.spyOn(rpcService, 'getRawMemPool').mockResolvedValue(['tx1', 'tx2']);
    jest.spyOn(rpcService, 'getMempoolEntry').mockResolvedValue({
      fees: { base: 0.1 },
      vsize: 220,
      time: 1_700_000_000,
    });
    jest.spyOn(rpcService, 'getRawTransaction').mockResolvedValue({
      fee: 0.1,
      size: 220,
      time: 1_700_000_000,
      vout: [{ value: 1.25 }],
    });

    const res = await request(app).get('/api/mempool').query({ limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.info).toMatchObject({
      size: 2,
      bytes: 1234,
      usage: 2048,
    });
    expect(res.body.data.txs).toHaveLength(2);
    expect(res.body.data.txs[0]).toMatchObject({
      txid: 'tx1',
    });
  });
});

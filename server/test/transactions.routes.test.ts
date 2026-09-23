import express from 'express';
import request from 'supertest';
import transactionsRoutes from '../src/routes/transactions.routes';
import { Transaction } from '../src/models/Transaction';
import * as chainTipService from '../src/services/chainTip.service';

function mockFindOneQuery<T>(value: T | null) {
  return {
    lean: jest.fn().mockResolvedValue(value),
  };
}

describe('transactions routes', () => {
  const app = express();
  app.use('/api/txs', transactionsRoutes);
  app.use('/api/tx', transactionsRoutes);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GET /api/txs/latest returns 400 for invalid count', async () => {
    const res = await request(app).get('/api/txs/latest').query({ count: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('GET /api/tx/:txid returns 400 for invalid txid format', async () => {
    const res = await request(app).get('/api/tx/not-a-txid');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('GET /api/tx/:txid returns 404 when tx is missing', async () => {
    const txid = 'd'.repeat(64);
    jest.spyOn(Transaction, 'findOne').mockReturnValue(mockFindOneQuery(null) as never);
    jest.spyOn(chainTipService, 'getChainTip').mockResolvedValue({
      height: 200,
      time: 1_700_000_100,
      hash: 'tip',
    });

    const res = await request(app).get(`/api/tx/${txid}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('GET /api/tx/:txid returns tx with computed confirmations', async () => {
    const txid = 'e'.repeat(64);
    jest.spyOn(Transaction, 'findOne').mockReturnValue(
      mockFindOneQuery({
        txid,
        blockheight: 150,
        totalValueOutSat: 200_000_000,
        totalValueInSat: 250_000_000,
        feeSat: 50_000_000,
      }) as never
    );
    jest.spyOn(chainTipService, 'getChainTip').mockResolvedValue({
      height: 200,
      time: 1_700_000_100,
      hash: 'tip',
    });

    const res = await request(app).get(`/api/tx/${txid}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      txid,
      blockheight: 150,
      confirmations: 51,
    });
  });
});

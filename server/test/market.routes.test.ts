import express from 'express';
import request from 'supertest';
import axios from 'axios';
import marketRoutes from '../src/routes/market.routes';
import { config } from '../src/config';

describe('market routes', () => {
  const app = express();
  app.use('/api/market', marketRoutes);

  const originalMarketConfig = { ...config.market };

  afterEach(() => {
    jest.restoreAllMocks();
    Object.assign(config.market, originalMarketConfig);
  });

  it('GET /api/market/history returns 400 for invalid days', async () => {
    const res = await request(app).get('/api/market/history').query({ days: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('GET /api/market returns normalized qutrade snapshot', async () => {
    const updatedAt = Math.floor(Date.now() / 1000);
    config.market.source = 'qutrade';
    config.market.qutradeApiBaseUrl = 'https://qutrade.io/api/v1';
    config.market.qutradePairUsdt = 'dfcn_usdt';
    config.market.qutradePairBtc = 'dfcn_btc';

    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        dfcn_usdt: {
          pair: 'dfcn_usdt',
          last_price: '0.00001011',
          vol_din: '10.9',
          open: '0.00001000',
          updated: updatedAt,
        },
        dfcn_btc: {
          pair: 'dfcn_btc',
          last_price: '0.00000011',
          updated: updatedAt,
        },
      },
    });

    const res = await request(app).get('/api/market');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      available: true,
      source: 'qutrade',
      price: {
        usd: 0.00001011,
        btc: 0.00000011,
        volume24h: 10.9,
        marketCap: null,
      },
    });
    expect(res.body.data.price.change24h).toBeCloseTo(1.1, 2);
    expect(typeof res.body.data.lastUpdatedAt).toBe('string');
    expect(res.body.data).toMatchObject({ freshness: 'fresh' });
    expect(res.body.data.ageSeconds).toBeLessThanOrEqual(1);
  });

  it('GET /api/market marks an old upstream price as stale', async () => {
    const updatedAt = Math.floor((Date.now() - 11 * 60 * 1000) / 1000);
    config.market.source = 'qutrade';
    config.market.qutradeApiBaseUrl = 'https://market-stale.example/api/v1';
    config.market.qutradePairUsdt = 'dfcn_usdt';
    config.market.qutradePairBtc = 'dfcn_btc';

    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        dfcn_usdt: { pair: 'dfcn_usdt', price: '0.00001011', trend: '1.1', timestamp: updatedAt },
        dfcn_btc: { pair: 'dfcn_btc', price: '0.00000011', timestamp: updatedAt },
      },
    });

    const res = await request(app).get('/api/market');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      available: true,
      freshness: 'stale',
    });
    expect(res.body.data.ageSeconds).toBeGreaterThanOrEqual(11 * 60);
  });

  it('GET /api/market/history returns qutrade trade points', async () => {
    config.market.source = 'qutrade';
    config.market.qutradeApiBaseUrl = 'https://qutrade.io/api/v1';
    config.market.qutradeHistoryPair = 'dfcn_usdt';
    config.market.qutradeTradesLimit = 100;

    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        result: [
          { timestamp: 1_710_000_200, price: '0.00001010', amount: '100000', total: '1.01' },
          { timestamp: 1_710_000_100, price: '0.00001020', amount: '50000', total: '0.51' },
        ],
      },
    });

    const res = await request(app).get('/api/market/history').query({ days: 7 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      available: true,
      source: 'qutrade',
      days: 7,
    });
    expect(Array.isArray(res.body.data.points)).toBe(true);
    expect(res.body.data.points).toHaveLength(2);
    expect(res.body.data.points[0]).toMatchObject({
      timestamp: 1_710_000_100,
      priceUsd: 0.0000102,
      volumeUsd: 0.51,
    });
    expect(res.body.data.points[1]).toMatchObject({
      timestamp: 1_710_000_200,
      priceUsd: 0.0000101,
      volumeUsd: 1.01,
    });
  });

  it('GET /api/market returns unavailable when coingecko is not configured', async () => {
    config.market.source = 'coingecko';
    config.market.coingeckoId = '';

    const res = await request(app).get('/api/market');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        available: false,
        source: null,
        price: null,
      },
    });
  });
});

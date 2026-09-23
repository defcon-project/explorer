import express from 'express';
import request from 'supertest';
import migrationRoutes, { clearTransparencyCache } from '../src/routes/migration.routes';
import { Transaction } from '../src/models/Transaction';
import * as chainTipService from '../src/services/chainTip.service';

const HOT_WALLET = 'D91nHyL8FSYWZHBVTnctnzvhC3QvynghCR';

function mockTxFindQuery(result: unknown[]) {
  const lean = jest.fn().mockResolvedValue(result);
  const select = jest.fn().mockReturnValue({ lean });
  const limit = jest.fn().mockReturnValue({ select });
  const sort = jest.fn().mockReturnValue({ limit });
  return { sort };
}

function mockChainTip(height = 500) {
  jest.spyOn(chainTipService, 'getChainTip').mockResolvedValue({
    height,
    hash: 'tip',
    time: 1_700_000_123,
  });
}

describe('migration transparency routes', () => {
  const app = express();
  app.use('/api/migration', migrationRoutes);

  afterEach(() => {
    jest.restoreAllMocks();
    clearTransparencyCache();
  });

  it('GET /api/migration/transparency returns 400 for invalid count', async () => {
    const res = await request(app).get('/api/migration/transparency').query({ count: 0 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('excludes change output going back to the hot wallet address', async () => {
    mockChainTip(500);
    jest.spyOn(Transaction, 'find').mockReturnValue(
      mockTxFindQuery([
        {
          txid: 'a'.repeat(64),
          blockheight: 490,
          blocktime: 1_700_000_000,
          vin: [{ address: HOT_WALLET }],
          vout: [
            // Change output → same hot wallet address, must be excluded
            {
              valueSat: '100000000',
              scriptPubKey: { addresses: [HOT_WALLET] },
            },
            // Outgoing payout → external address, must be included
            {
              valueSat: '250000000000',
              scriptPubKey: { addresses: ['DRecipientAddress111111111111111111111'] },
            },
          ],
        },
      ]) as never
    );

    const res = await request(app).get('/api/migration/transparency').query({ count: 10 });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      txid: 'a'.repeat(64),
      vout: 1,
      toAddress: 'DRecipientAddress111111111111111111111',
      amountSat: '250000000000',
      amount: 2500,
      confirmations: 11,
    });
    expect(res.body.data.summary).toMatchObject({
      outgoingTxCount: 1,
      outgoingTransferCount: 1,
      uniqueRecipients: 1,
      totalOutgoingSat: '250000000000',
      totalOutgoing: 2500,
    });
  });

  it('excludes change output going to a different wallet-owned (HD change) address', async () => {
    mockChainTip(500);
    const changeAddress = 'DChangeAddr22222222222222222222222222';
    jest.spyOn(Transaction, 'find').mockReturnValue(
      mockTxFindQuery([
        {
          txid: 'b'.repeat(64),
          blockheight: 495,
          blocktime: 1_700_001_000,
          // The wallet used BOTH the hot wallet AND the change address as inputs
          // in a prior tx, so both are wallet-owned.
          vin: [{ address: HOT_WALLET }, { address: changeAddress }],
          vout: [
            // Recipient payout
            { valueSat: '100000000', scriptPubKey: { addresses: ['DRecipient111'] } },
            // Change back to the HD wallet change address → must be excluded
            { valueSat: '999000000', scriptPubKey: { addresses: [changeAddress] } },
          ],
        },
      ]) as never
    );

    const res = await request(app).get('/api/migration/transparency').query({ count: 10 });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].toAddress).toBe('DRecipient111');
    expect(res.body.data.items[0].amountSat).toBe('100000000');
    expect(res.body.data.summary.outgoingTxCount).toBe(1);
    expect(res.body.data.summary.uniqueRecipients).toBe(1);
    expect(res.body.data.summary.totalOutgoingSat).toBe('100000000');
  });

  it('handles multiple txs, one payout row per tx, correct KPIs', async () => {
    mockChainTip(600);
    jest.spyOn(Transaction, 'find').mockReturnValue(
      mockTxFindQuery([
        {
          // TX with payout to DRecipientA and a fresh HD-wallet change address.
          // The change address has never appeared as an input, so buildOwnedSet
          // won't detect it — one-per-TX break prevents it from being included.
          txid: 'c'.repeat(64),
          blockheight: 590,
          blocktime: 1_700_010_000,
          vin: [{ address: HOT_WALLET }],
          vout: [
            { valueSat: '500000000', scriptPubKey: { addresses: ['DRecipientA'] } },
            { valueSat: '99500000000', scriptPubKey: { addresses: ['DFreshChangeAddr111'] } }, // HD change
          ],
        },
        {
          // TX with payout to DRecipientC and explicit hot-wallet change.
          txid: 'd'.repeat(64),
          blockheight: 580,
          blocktime: 1_700_009_000,
          vin: [{ address: HOT_WALLET }],
          vout: [
            { valueSat: '200000000', scriptPubKey: { addresses: ['DRecipientC'] } },
            { valueSat: '50000000', scriptPubKey: { addresses: [HOT_WALLET] } }, // change
          ],
        },
      ]) as never
    );

    const res = await request(app).get('/api/migration/transparency').query({ count: 10 });
    expect(res.status).toBe(200);
    const { items, summary } = res.body.data;
    // One row per TX: DRecipientA from tx-c, DRecipientC from tx-d
    expect(items).toHaveLength(2);
    expect(items[0].toAddress).toBe('DRecipientA');
    expect(items[1].toAddress).toBe('DRecipientC');
    expect(summary.outgoingTxCount).toBe(2);
    expect(summary.outgoingTransferCount).toBe(2);
    expect(summary.uniqueRecipients).toBe(2);
    expect(summary.totalOutgoingSat).toBe('700000000'); // 500 + 200
  });

  it('does not double-count the same vout when called multiple times', async () => {
    mockChainTip(500);
    jest.spyOn(Transaction, 'find').mockReturnValue(
      mockTxFindQuery([
        {
          txid: 'e'.repeat(64),
          blockheight: 490,
          blocktime: 1_700_000_000,
          vin: [{ address: HOT_WALLET }],
          vout: [
            { valueSat: '100000000', scriptPubKey: { addresses: ['DRecipient999'] } },
          ],
        },
      ]) as never
    );

    const res = await request(app).get('/api/migration/transparency').query({ count: 10 });
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.summary.outgoingTransferCount).toBe(1);
  });
});

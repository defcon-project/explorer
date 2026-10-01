import express from 'express';
import request from 'supertest';
import richlistRoutes, { invalidateRichlistCache } from '../src/routes/richlist.routes';
import { Address } from '../src/models/Address';

const app = express();
app.use('/richlist', richlistRoutes);

describe('richlist page cache', () => {
  beforeEach(() => invalidateRichlistCache());

  it('bounds cached pages and reloads evicted pages without changing the response', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const aggregate = vi.spyOn(Address, 'aggregate').mockResolvedValue([
      { data: [{ address: 'Dtest', balanceSat: '100000000', txCount: 2, lastSeen: 10 }], countRows: [{ total: 1000 }] },
    ] as never);
    const first = await request(app).get('/richlist?page=1&limit=1');
    expect(first.status).toBe(200);
    for (let page = 2; page <= 129; page += 1) {
      expect((await request(app).get(`/richlist?page=${page}&limit=1`)).status).toBe(200);
    }
    expect(aggregate).toHaveBeenCalledTimes(129);
    await request(app).get('/richlist?page=129&limit=1');
    expect(aggregate).toHaveBeenCalledTimes(129);
    const reloaded = await request(app).get('/richlist?page=1&limit=1');
    expect(aggregate).toHaveBeenCalledTimes(130);
    expect(reloaded.body).toEqual(first.body);
  });
});

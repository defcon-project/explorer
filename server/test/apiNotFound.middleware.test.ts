import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { rejectUnknownApiRequest } from '../src/middleware/apiNotFound';

function createApp() {
  const app = express();
  app.use('/api', rejectUnknownApiRequest);
  app.get('*', (_req, res) => res.type('html').send('<!doctype html><title>DeFCoN Explorer</title>'));
  return app;
}

describe('unknown API route boundary', () => {
  it('returns a JSON 404 rather than an SPA shell for an unregistered API path', async () => {
    const res = await request(createApp()).get('/api/v1/stats');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'API endpoint not found' },
    });
  });

  it('preserves the API documentation SPA entry at /api', async () => {
    const res = await request(createApp()).get('/api');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('DeFCoN Explorer');
  });

  it('returns JSON for non-GET requests to the documentation entry', async () => {
    const res = await request(createApp()).post('/api');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

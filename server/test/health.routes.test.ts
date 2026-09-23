import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import healthRoutes from '../src/routes/health.routes';
import { rpcService } from '../src/services/rpc.service';

function mockReadyState(value: number) {
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    enumerable: true,
    get: () => value,
  });
}

describe('health routes', () => {
  const app = express();
  app.use('/api/health', healthRoutes);

  const originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(
    mongoose.connection,
    'readyState'
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalReadyStateDescriptor) {
      Object.defineProperty(mongoose.connection, 'readyState', originalReadyStateDescriptor);
    }
  });

  it('GET /api/health returns degraded when DB is disconnected', async () => {
    mockReadyState(0);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'degraded' });
  });

  it('GET /api/health/ready returns ok when DB and RPC are connected', async () => {
    mockReadyState(1);
    jest.spyOn(rpcService, 'testConnection').mockResolvedValue(true);

    const res = await request(app).get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/health/ready returns down on RPC errors', async () => {
    mockReadyState(1);
    jest.spyOn(rpcService, 'testConnection').mockRejectedValue(new Error('rpc failure'));

    const res = await request(app).get('/api/health/ready');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ status: 'down' });
  });
});

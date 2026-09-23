import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { rpcService } from '../services/rpc.service';

const router = Router();

async function liveHealth(_req: Request, res: Response) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const status = dbConnected ? 'ok' : 'degraded';
    res.json({ status });
  } catch {
    res.status(500).json({ status: 'down' });
  }
}

router.get('/', liveHealth);
router.get('/live', liveHealth);

router.get('/ready', async (_req: Request, res: Response) => {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const rpcConnected = await rpcService.testConnection();

    const status =
      dbConnected && rpcConnected
        ? 'ok'
        : dbConnected || rpcConnected
          ? 'degraded'
          : 'down';
    res.json({ status });
  } catch {
    res.status(500).json({ status: 'down' });
  }
});

export default router;

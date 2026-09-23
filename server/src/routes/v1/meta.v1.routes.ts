import { Router, Request, Response } from 'express';
import { COIN } from '@defcon/shared';
import pkg from '../../../../package.json';
import { withCachePolicy } from '../../middleware/cachePolicy';

const router = Router();

const META_RESPONSE = {
  success: true,
  data: {
    network: COIN.NAME,
    ticker: COIN.TICKER,
    addressPrefix: COIN.ADDRESS_PREFIX,
    decimals: COIN.DECIMALS,
    blockTimeSeconds: COIN.BLOCK_TIME_SECONDS,
    masternodeCollateral: COIN.MASTERNODE_COLLATERAL,
    explorerVersion: pkg.version || '1.0.0',
    apiVersion: '1',
  },
};

router.get('/', withCachePolicy('long'), (_req: Request, res: Response) => {
  res.json(META_RESPONSE);
});

export default router;

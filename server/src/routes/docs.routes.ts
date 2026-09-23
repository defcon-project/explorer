import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '../docs/openapi';
import { config } from '../config';

const router = Router();

router.get('/openapi.json', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(openApiDocument);
});

router.use('/', swaggerUi.serve);
router.get(
  '/',
  swaggerUi.setup(openApiDocument, {
    explorer: true,
    customSiteTitle: 'DeFCoN Explorer API Docs',
    swaggerOptions: {
      // Persisting auth in browser storage is convenient for local dev but
      // leaks credentials on shared/public machines. Only allow it outside
      // production.
      persistAuthorization: config.nodeEnv !== 'production',
    },
  })
);

export default router;

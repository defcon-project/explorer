import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { networkNoiseSummaryApiResponseSchema } from '@defcon/shared/dist/contracts';
import { config } from '../../config';
import { withCachePolicy } from '../../middleware/cachePolicy';
import {
  networkNoiseService,
  type NetworkNoisePayload,
} from '../../services/networkNoise.service';
import { resolveRequestIp } from '../../utils/requestIp';
import {
  firstValidationIssueMessage,
  sendInternalError,
  sendValidationError,
} from '../../utils/validation';

const router = Router();

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => resolveRequestIp(req, config.rateLimit.ipHeaders),
});

const nullableInt = z.number().int().nonnegative().nullable().optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

const signalSchema = z.object({
  type: z.string().trim().min(1).max(64).regex(/^[a-z0-9_]+$/),
  fingerprint: z.string().trim().min(8).max(128),
  count: z.number().int().min(1).max(100000),
  firstSeenAt: z.string().datetime({ offset: true }),
  lastSeenAt: z.string().datetime({ offset: true }),
  peerIps: z.array(z.string().ip()).max(20).optional(),
  sample: nullableText(300),
});

const ingestSchema = z.object({
  schemaVersion: z.literal(1),
  agentVersion: z.string().trim().min(1).max(32),
  nodeId: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  nodeRole: z.enum(['seed', 'fullnode', 'test_mn', 'masternode', 'unknown']),
  observedAt: z.string().datetime({ offset: true }),
  sequence: z.number().int().nonnegative(),
  snapshot: z.object({
    ip: z.string().ip(),
    walletVersion: nullableText(64),
    blockHeight: nullableInt,
    bestBlockHash: nullableText(64),
    chainLockHeight: nullableInt,
    chainLockHash: nullableText(64),
    connections: nullableInt,
    inbound: nullableInt,
    outbound: nullableInt,
    syncing: z.boolean().nullable().optional(),
  }),
  signals: z.array(signalSchema).max(100),
});

function bearerToken(req: Request): string {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function safeTokenEquals(actual: string, expected: string): boolean {
  // Hash both sides to fixed-length digests first, so the comparison takes the
  // same time whatever the token lengths are and does not leak the length.
  const actualHash = crypto.createHash('sha256').update(actual, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

router.post('/ingest', ingestLimiter, async (req: Request, res: Response) => {
  if (!config.networkNoise.enabled) {
    return res.status(503).json({
      success: false,
      error: { code: 'DISABLED', message: 'Network noise ingest is disabled' },
    });
  }

  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, firstValidationIssueMessage(parsed.error));
  }

  const expectedToken = config.networkNoise.ingestTokens[parsed.data.nodeId];
  const token = bearerToken(req);
  if (!expectedToken || !token || !safeTokenEquals(token, expectedToken)) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid node ingest credentials' },
    });
  }

  try {
    const result = await networkNoiseService.ingest(parsed.data as NetworkNoisePayload);
    return res.status(result.duplicate ? 200 : 202).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return sendInternalError(res, 'Failed to ingest network noise telemetry', error);
  }
});

router.get('/summary', withCachePolicy('no-store'), async (req: Request, res: Response) => {
  const parsedHours = Number.parseInt(String(req.query.hours ?? '24'), 10);
  const hours = Math.min(Math.max(Number.isFinite(parsedHours) ? parsedHours : 24, 1), 720);

  try {
    const data = await networkNoiseService.getSummary(hours);
    return res.json(networkNoiseSummaryApiResponseSchema.parse({ success: true, data }));
  } catch (error) {
    return sendInternalError(res, 'Failed to load network noise summary', error);
  }
});

export default router;

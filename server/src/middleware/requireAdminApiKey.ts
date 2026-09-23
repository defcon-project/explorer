import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Protects /api/admin/* routes with an API key.
 *
 * Accepted header forms:
 * - x-api-key: <key>
 * - Authorization: Bearer <key>
 */
export function requireAdminApiKey(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = config.admin.apiKey;

  if (!expectedKey) {
    logger.error('Admin route accessed but ADMIN_API_KEY is not configured.');
    res.status(500).json({
      success: false,
      error: {
        code: 'ADMIN_API_KEY_NOT_CONFIGURED',
        message: 'Admin API key not configured on server.',
      },
    });
    return;
  }

  const providedKey = extractAdminApiKey(req);
  if (!providedKey) {
    res.status(401).json({
      success: false,
      error: {
        code: 'ADMIN_API_KEY_REQUIRED',
        message: 'Unauthorized: API key required.',
      },
    });
    return;
  }

  if (!safeCompareApiKeys(providedKey, expectedKey)) {
    logger.warn(`Admin route rejected - invalid API key from ${req.ip ?? 'unknown'}`);
    res.status(403).json({
      success: false,
      error: {
        code: 'ADMIN_API_KEY_INVALID',
        message: 'Forbidden: invalid API key.',
      },
    });
    return;
  }

  next();
}

function extractAdminApiKey(req: Request): string | undefined {
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string') {
    const trimmed = xApiKey.trim();
    if (trimmed.length > 0) return trimmed;
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) return token;
  }

  return undefined;
}

function safeCompareApiKeys(provided: string, expected: string): boolean {
  // Hash both inputs to fixed-length (32 bytes) buffers BEFORE comparing.
  // Comparing the raw strings would short-circuit on length mismatch and
  // allows a remote attacker to learn the expected key length via timing.
  // SHA-256 over both sides removes that side-channel entirely.
  const providedHash = createHash('sha256').update(provided, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedHash, expectedHash);
}

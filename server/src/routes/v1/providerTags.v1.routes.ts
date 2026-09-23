import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../../config';
import { ProviderTagSubmission } from '../../models/ProviderTagSubmission';
import { ProviderTag } from '../../models/ProviderTag';
import { resolveRequestIp } from '../../utils/requestIp';
import { withCachePolicy } from '../../middleware/cachePolicy';
import {
  isValidIpv4Cidr,
  normalizeProviderTagEntry,
  parseProviderTagBulkEntries,
  type ProviderTagSource,
} from '../../services/providerTag.service';
import { getEnrichedPayload, type EnrichedNode } from '../../services/masternode.service';
import { firstValidationIssueMessage, sendInternalError, sendValidationError } from '../../utils/validation';
import { telegramService } from '../../services/telegram.service';

const router = Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => resolveRequestIp(req, config.rateLimit.ipHeaders),
});

const submitBulkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => resolveRequestIp(req, config.rateLimit.ipHeaders),
});

const providerTagSourceSchema = z.enum(['operator_reported', 'manual', 'asn', 'rdns']);

const submitSchema = z.object({
  cidr: z
    .string()
    .trim()
    .min(3, 'CIDR is required')
    .max(64, 'CIDR is too long')
    .refine((value) => normalizeProviderTagEntry(value) != null, 'CIDR must be a valid IPv4, IPv4:port, or IPv4 CIDR'),
  provider: z.string().trim().min(2, 'Provider is required').max(80, 'Provider is too long'),
  source: providerTagSourceSchema.optional(),
  confidence: z.coerce.number().min(0).max(100).optional(),
  submittedBy: z.string().trim().max(120, 'submittedBy is too long').optional(),
  reporter: z.string().trim().max(80, 'Reporter is too long').optional(),
  contact: z.string().trim().max(120, 'Contact is too long').optional(),
  evidenceUrl: z
    .string()
    .trim()
    .max(2048, 'Evidence URL is too long')
    .optional()
    .refine(
      (value) => !value || /^https?:\/\//i.test(value),
      'Evidence URL must start with http:// or https://'
    ),
  notes: z.string().trim().max(1000, 'Notes are too long').optional(),
});

const bulkSubmitSchema = z
  .object({
    provider: z.string().trim().min(2, 'Provider is required').max(80, 'Provider is too long'),
    source: providerTagSourceSchema.optional().default('operator_reported'),
    confidence: z.coerce.number().min(0).max(100).optional().default(85),
    submittedBy: z.string().trim().max(120, 'submittedBy is too long').optional(),
    reporter: z.string().trim().max(80, 'Reporter is too long').optional(),
    contact: z.string().trim().max(120, 'Contact is too long').optional(),
    evidenceUrl: z
      .string()
      .trim()
      .max(2048, 'Evidence URL is too long')
      .optional()
      .refine(
        (value) => !value || /^https?:\/\//i.test(value),
        'Evidence URL must start with http:// or https://'
      ),
    notes: z.string().trim().max(2000, 'Notes are too long').optional(),
    rawText: z.string().optional(),
    entries: z.array(z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    const hasEntries = Array.isArray(value.entries) && value.entries.length > 0;
    const hasRawText = typeof value.rawText === 'string' && value.rawText.trim().length > 0;
    if (!hasEntries && !hasRawText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide entries or rawText with at least one line',
      });
    }
  });

function splitBulkInputLines(payload: z.infer<typeof bulkSubmitSchema>): string[] {
  if (Array.isArray(payload.entries) && payload.entries.length > 0) {
    return payload.entries.map((entry) => String(entry ?? ''));
  }
  return String(payload.rawText || '').split(/\r?\n/g);
}

function buildActiveProviderTagRows(nodes: EnrichedNode[]) {
  const rows = new Map<
    string,
    {
      cidr: string;
      provider: string;
      source: ProviderTagSource;
      nodes: number;
      confidenceTotal: number;
      confidenceSamples: number;
      evidenceUrl: string | null;
    }
  >();

  for (const node of nodes) {
    if (node.providerSource !== 'tag') continue;
    const cidr = String(node.providerTagCidr || '').trim();
    if (!cidr) continue;

    const provider = String(node.provider || 'Unknown').trim() || 'Unknown';
    const source = (node.providerTagSource || 'manual') as ProviderTagSource;
    const key = `${cidr}|${provider}|${source}`;
    const current = rows.get(key) || {
      cidr,
      provider,
      source,
      nodes: 0,
      confidenceTotal: 0,
      confidenceSamples: 0,
      evidenceUrl: node.providerEvidenceUrl || null,
    };

    current.nodes += 1;
    if (typeof node.providerConfidence === 'number' && Number.isFinite(node.providerConfidence)) {
      current.confidenceTotal += node.providerConfidence;
      current.confidenceSamples += 1;
    }
    if (!current.evidenceUrl && node.providerEvidenceUrl) current.evidenceUrl = node.providerEvidenceUrl;
    rows.set(key, current);
  }

  return Array.from(rows.values())
    .map((row) => ({
      cidr: row.cidr,
      provider: row.provider,
      source: row.source,
      nodes: row.nodes,
      confidence:
        row.confidenceSamples > 0
          ? Math.round((row.confidenceTotal / row.confidenceSamples) * 10) / 10
          : null,
      evidenceUrl: row.evidenceUrl,
    }))
    .sort((a, b) => b.nodes - a.nodes || a.provider.localeCompare(b.provider) || a.cidr.localeCompare(b.cidr));
}

router.get('/active', withCachePolicy('medium'), async (_req: Request, res: Response) => {
  try {
    const payload = await getEnrichedPayload();
    const taggedNodes = payload.nodes.filter((node) => node.providerSource === 'tag').length;

    return res.json({
      success: true,
      data: {
        totalNodes: payload.total,
        taggedNodes,
        taggedCoveragePct: payload.total > 0 ? (taggedNodes / payload.total) * 100 : 0,
        rows: buildActiveProviderTagRows(payload.nodes),
      },
    });
  } catch (error) {
    return sendInternalError(res, 'Failed to load active provider tags', error);
  }
});

router.post('/submit', submitLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = submitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendValidationError(res, firstValidationIssueMessage(parsed.error));
    }

    const payload = parsed.data;
    const normalizedCidr = normalizeProviderTagEntry(payload.cidr);
    if (!normalizedCidr || !isValidIpv4Cidr(normalizedCidr)) {
      return sendValidationError(res, 'CIDR must be a valid IPv4, IPv4:port, or IPv4 CIDR');
    }

    const row = await ProviderTagSubmission.create({
      cidr: normalizedCidr,
      provider: payload.provider,
      source: payload.source || 'operator_reported',
      confidence:
        typeof payload.confidence === 'number' && Number.isFinite(payload.confidence)
          ? Math.round(payload.confidence)
          : 85,
      submittedBy: payload.submittedBy || payload.reporter || null,
      reporter: payload.reporter || null,
      contact: payload.contact || null,
      evidenceUrl: payload.evidenceUrl || null,
      notes: payload.notes || null,
      status: 'pending',
    });

    telegramService.notifyProviderTagSubmission({
      id: String(row._id),
      cidr: row.cidr,
      provider: row.provider,
      reporter: row.reporter,
      contact: row.contact,
      evidenceUrl: row.evidenceUrl,
      notes: row.notes,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      data: {
        id: String(row._id),
        status: row.status,
        createdAt: row.createdAt,
        message: 'Submission received and queued for review',
      },
    });
  } catch (error) {
    return sendInternalError(res, 'Failed to submit provider tag', error);
  }
});

router.post('/submit-bulk', submitBulkLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = bulkSubmitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendValidationError(res, firstValidationIssueMessage(parsed.error));
    }

    const payload = parsed.data;
    const lines = splitBulkInputLines(payload);
    const preview = parseProviderTagBulkEntries(lines);

    if (preview.validEntries.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'No valid entries to submit',
        },
        data: {
          provider: payload.provider,
          totalLines: preview.totalLines,
          validEntries: 0,
          duplicatesSkipped: preview.duplicatesSkipped,
          invalidLines: preview.invalidLines,
          normalizedCidrs: [],
        },
      });
    }

    const provider = payload.provider.trim();
    const source = payload.source as ProviderTagSource;
    const confidence = Math.max(0, Math.min(100, Math.round(payload.confidence)));
    const normalizedCidrs = preview.validEntries;

    const [pendingRows, activeRows] = await Promise.all([
      ProviderTagSubmission.find({
        provider,
        cidr: { $in: normalizedCidrs },
        status: 'pending',
      })
        .select({ cidr: 1 })
        .lean<Array<{ cidr: string }>>(),
      ProviderTag.find({
        provider,
        cidr: { $in: normalizedCidrs },
        active: true,
      })
        .select({ cidr: 1 })
        .lean<Array<{ cidr: string }>>(),
    ]);

    const existingCidrs = new Set<string>();
    for (const row of pendingRows) existingCidrs.add(String(row.cidr || '').toLowerCase());
    for (const row of activeRows) existingCidrs.add(String(row.cidr || '').toLowerCase());

    const cidrsToInsert = normalizedCidrs.filter((cidr) => !existingCidrs.has(cidr.toLowerCase()));
    const alreadyExistsSkipped = normalizedCidrs.length - cidrsToInsert.length;

    if (cidrsToInsert.length > 0) {
      const docs = cidrsToInsert.map((cidr) => ({
        cidr,
        provider,
        source,
        confidence,
        submittedBy: payload.submittedBy || payload.reporter || null,
        reporter: payload.reporter || null,
        contact: payload.contact || null,
        evidenceUrl: payload.evidenceUrl || null,
        notes: payload.notes || null,
        status: 'pending',
      }));
      await ProviderTagSubmission.insertMany(docs, { ordered: false });
    }

    return res.status(201).json({
      success: true,
      data: {
        provider,
        source,
        confidence,
        totalLines: preview.totalLines,
        validEntries: normalizedCidrs.length,
        submitted: cidrsToInsert.length,
        duplicatesSkipped: preview.duplicatesSkipped,
        invalidLines: preview.invalidLines,
        normalizedCidrs,
        alreadyExistsSkipped,
        message:
          cidrsToInsert.length > 0
            ? `Queued ${cidrsToInsert.length} provider tags for admin review`
            : 'All valid entries were already pending or active',
      },
    });
  } catch (error) {
    return sendInternalError(res, 'Failed to submit provider tags in bulk', error);
  }
});

export default router;

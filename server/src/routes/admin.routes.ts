import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { ProviderTag } from '../models/ProviderTag';
import { ProviderTagSubmission } from '../models/ProviderTagSubmission';
import { clearProviderTagCache } from '../services/providerTag.service';

/**
 * /api/admin/* routes
 *
 * All routes here are protected by requireAdminApiKey middleware,
 * applied at mount time in routes/index.ts.
 */
const router = Router();

// GET /api/admin/ping - liveness check for the admin namespace
router.get('/ping', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      ok: true,
      namespace: 'admin',
    },
  });
});

// GET /api/admin/provider-tags - list configured provider tag rules
router.get('/provider-tags', async (_req: Request, res: Response) => {
  try {
    const rows = await ProviderTag.find({})
      .sort({ active: -1, updatedAt: -1 })
      .lean();

    res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list provider tags',
      },
    });
  }
});

// POST /api/admin/provider-tags - create or update a CIDR tag rule
router.post('/provider-tags', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const cidr = String(body?.cidr || '').trim();
    const provider = String(body?.provider || '').trim();
    const sourceRaw = String(body?.source || 'manual').trim().toLowerCase();
    const confidenceRaw = Number(body?.confidence);

    if (!cidr || !provider) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'cidr and provider are required',
        },
      });
    }

    if (!['operator_reported', 'manual', 'asn', 'rdns'].includes(sourceRaw)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'source must be one of: operator_reported, manual, asn, rdns',
        },
      });
    }

    const confidence =
      Number.isFinite(confidenceRaw) && confidenceRaw >= 0 && confidenceRaw <= 100
        ? Math.round(confidenceRaw)
        : 85;

    const update = {
      provider,
      source: sourceRaw,
      confidence,
      reporter: body?.reporter ? String(body.reporter) : null,
      evidenceUrl: body?.evidenceUrl ? String(body.evidenceUrl) : null,
      notes: body?.notes ? String(body.notes) : null,
      active: body?.active == null ? true : Boolean(body.active),
      validFrom: body?.validFrom ? new Date(String(body.validFrom)) : null,
      validTo: body?.validTo ? new Date(String(body.validTo)) : null,
    };

    const row = await ProviderTag.findOneAndUpdate(
      { cidr, provider },
      { $set: update, $setOnInsert: { cidr } },
      { new: true, upsert: true }
    ).lean();

    clearProviderTagCache();

    return res.status(201).json({
      success: true,
      data: row,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to save provider tag',
      },
    });
  }
});

// PATCH /api/admin/provider-tags/:id/active - toggle a tag rule without deleting history
router.patch('/provider-tags/:id/active', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid tag id',
        },
      });
    }

    const active = Boolean((req.body as Record<string, unknown>)?.active);
    const row = await ProviderTag.findByIdAndUpdate(
      id,
      { $set: { active } },
      { new: true }
    ).lean();

    if (!row) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Provider tag not found',
        },
      });
    }

    clearProviderTagCache();

    return res.json({
      success: true,
      data: row,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to update provider tag',
      },
    });
  }
});

// GET /api/admin/provider-tags/submissions - review queue
router.get('/provider-tags/submissions', async (req: Request, res: Response) => {
  try {
    const statusRaw = String(req.query.status || 'pending').trim().toLowerCase();
    const limitRaw = Number.parseInt(String(req.query.limit || '100'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    const filter: Record<string, unknown> = {};
    if (['pending', 'approved', 'rejected'].includes(statusRaw)) {
      filter.status = statusRaw;
    }

    const rows = await ProviderTagSubmission.find(filter)
      .sort({ status: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list submissions',
      },
    });
  }
});

// POST /api/admin/provider-tags/submissions/:id/approve - approve + activate provider tag
router.post('/provider-tags/submissions/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid submission id',
        },
      });
    }

    const submission = await ProviderTagSubmission.findById(id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Submission not found',
        },
      });
    }

    const confidenceRaw = Number((req.body as Record<string, unknown>)?.confidence);
    const submissionConfidence =
      typeof submission.confidence === 'number' && Number.isFinite(submission.confidence)
        ? Math.round(submission.confidence)
        : 85;
    const confidence =
      Number.isFinite(confidenceRaw) && confidenceRaw >= 0 && confidenceRaw <= 100
        ? Math.round(confidenceRaw)
        : submissionConfidence;
    const reviewNote = (req.body as Record<string, unknown>)?.reviewNote
      ? String((req.body as Record<string, unknown>).reviewNote)
      : null;
    const reviewer = (req.body as Record<string, unknown>)?.reviewer
      ? String((req.body as Record<string, unknown>).reviewer)
      : null;

    const providerTag = await ProviderTag.findOneAndUpdate(
      { cidr: submission.cidr, provider: submission.provider },
      {
        $set: {
          source: submission.source || 'operator_reported',
          confidence,
          reporter: submission.reporter || null,
          evidenceUrl: submission.evidenceUrl || null,
          notes: submission.notes || null,
          active: true,
        },
        $setOnInsert: {
          cidr: submission.cidr,
          provider: submission.provider,
        },
      },
      { new: true, upsert: true }
    );

    submission.status = 'approved';
    submission.reviewedAt = new Date();
    submission.reviewer = reviewer;
    submission.reviewNote = reviewNote;
    submission.resolvedTagId = providerTag._id;
    await submission.save();

    clearProviderTagCache();

    return res.json({
      success: true,
      data: {
        submission,
        providerTag,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to approve submission',
      },
    });
  }
});

// POST /api/admin/provider-tags/submissions/:id/reject - reject provider tag submission
router.post('/provider-tags/submissions/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid submission id',
        },
      });
    }

    const reviewNote = (req.body as Record<string, unknown>)?.reviewNote
      ? String((req.body as Record<string, unknown>).reviewNote)
      : null;
    const reviewer = (req.body as Record<string, unknown>)?.reviewer
      ? String((req.body as Record<string, unknown>).reviewer)
      : null;

    const submission = await ProviderTagSubmission.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewer,
          reviewNote,
        },
      },
      { new: true }
    ).lean();

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Submission not found',
        },
      });
    }

    return res.json({
      success: true,
      data: submission,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to reject submission',
      },
    });
  }
});

export default router;

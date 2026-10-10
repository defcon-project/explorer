import { Router } from 'express';
import { banAttributionApiResponseSchema, banAttributionQuerySchema } from '@defcon/shared/dist/contracts';
import { withCachePolicy } from '../../middleware/cachePolicy';
import { getBanAttribution } from '../../services/banAttribution.service';
import { firstValidationIssueMessage, sendInternalError, sendValidationError } from '../../utils/validation';

const router = Router();
router.get('/ban-attribution', withCachePolicy('no-store'), async (req, res) => {
  const parsed = banAttributionQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendValidationError(res, firstValidationIssueMessage(parsed.error));
  try { return res.json(banAttributionApiResponseSchema.parse({ success: true, data: await getBanAttribution(parsed.data) })); }
  catch (error) { return sendInternalError(res, 'Failed to load ban attribution', error); }
});
export default router;

import { Router } from 'express';
import { poseChainApiResponseSchema, poseChainQuerySchema } from '@defcon/shared/dist/contracts';
import { withCachePolicy } from '../../middleware/cachePolicy';
import { getPoseChainData } from '../../services/poseChainQuery.service';
import { firstValidationIssueMessage, sendInternalError, sendValidationError } from '../../utils/validation';

const router = Router();
router.get('/pose-chain', withCachePolicy('no-store'), async (req, res) => {
  const parsed = poseChainQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendValidationError(res, firstValidationIssueMessage(parsed.error));
  try {
    return res.json(poseChainApiResponseSchema.parse({ success: true, data: await getPoseChainData(parsed.data) }));
  } catch (error) { return sendInternalError(res, 'Failed to load PoSe chain evidence', error); }
});
export default router;

import { Router } from 'express';
import { operatorDiagnosisApiResponseSchema } from '@defcon/shared/dist/contracts';
import { getOperatorDiagnosis } from '../../services/operatorDiagnosis.service';
import { withCachePolicy } from '../../middleware/cachePolicy';
import { sendServiceUnavailable } from '../../utils/validation';
const router = Router();
router.get('/operator-diagnosis', withCachePolicy('no-store'), async (_req, res) => {
  try { res.json(operatorDiagnosisApiResponseSchema.parse({ success: true, data: await getOperatorDiagnosis() })); }
  catch { sendServiceUnavailable(res, 'Operator diagnosis unavailable'); }
});
export default router;

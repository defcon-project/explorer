import { z } from 'zod';
import { apiSuccessSchema } from './api';

export const operatorDiagnosisSchema = z.object({
  code: z.enum(['BAN_NEXT_DKG', 'REVIVE_LOOP', 'OLD_VERSION', 'WRONG_CHAIN']),
  level: z.enum(['action', 'warn', 'info']),
  evidence: z.enum(['chain', 'pattern', 'probe']),
  message: z.string(), hint: z.string(), since: z.string().datetime({ offset: true }),
  source: z.string(), operatorAction: z.boolean(),
}).refine(d => !d.operatorAction || (d.level === 'action' && d.evidence === 'chain'),
  'Operator action highlighting requires chain evidence');
export const operatorDiagnosisDataSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  registeredCount: z.number().int().nonnegative(),
  maxPenalty: z.number().int().positive(),
  historySince: z.string().datetime({ offset: true }), historyLimited: z.boolean(),
  nodes: z.array(z.object({
    proTxHash: z.string().regex(/^[a-f0-9]{64}$/), service: z.string(),
    operatorDiagnosis: z.array(operatorDiagnosisSchema),
  })),
});
export const operatorDiagnosisApiResponseSchema = apiSuccessSchema(operatorDiagnosisDataSchema);
export type OperatorDiagnosis = z.infer<typeof operatorDiagnosisSchema>;
export type OperatorDiagnosisData = z.infer<typeof operatorDiagnosisDataSchema>;

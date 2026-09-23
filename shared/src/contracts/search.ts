import { z } from 'zod';
import { apiSuccessSchema } from './api';

const hashSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);

const blockSearchResultSchema = z.object({
  type: z.literal('block'),
  matchedBy: z.enum(['height', 'hash']),
  // Keep unversioned legacy fields intact while enforcing the documented keys.
  result: z
    .object({
      height: z.number().int().nonnegative(),
      hash: hashSchema,
    })
    .passthrough(),
});

const transactionSearchResultSchema = z.object({
  type: z.literal('transaction'),
  matchedBy: z.literal('txid'),
  result: z
    .object({
      txid: hashSchema,
    })
    .passthrough(),
});

const addressSearchResultSchema = z.object({
  type: z.literal('address'),
  matchedBy: z.literal('address'),
  result: z
    .object({
      address: z.string().min(1),
    })
    .passthrough(),
});

export const searchResultSchema = z.discriminatedUnion('type', [
  blockSearchResultSchema,
  transactionSearchResultSchema,
  addressSearchResultSchema,
]);

export const searchApiResponseSchema = apiSuccessSchema(searchResultSchema);

export type SearchResultContract = z.infer<typeof searchResultSchema>;
export type SearchApiResponse = z.infer<typeof searchApiResponseSchema>;


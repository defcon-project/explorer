import { z } from 'zod';

/**
 * Shared envelope for successful, non-paginated API responses.
 *
 * Keep this in the shared package so a response validated by the server has
 * the same shape the browser compiles against.
 */
export function apiSuccessSchema<TData extends z.ZodTypeAny>(data: TData) {
  return z.object({
    success: z.literal(true),
    data,
  });
}


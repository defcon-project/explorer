import { z } from 'zod';
import { apiSuccessSchema } from './api';

const nonNegativeNumber = z.number().finite().nonnegative();
const nonNegativeInteger = z.number().int().nonnegative();

export const statsDataSchema = z.object({
  blockHeight: nonNegativeInteger,
  lastBlockTime: nonNegativeInteger.nullable(),
  difficulty: nonNegativeNumber,
  hashrate: nonNegativeNumber,
  connections: nonNegativeInteger,
  mempool: z.object({
    size: nonNegativeInteger,
    bytes: nonNegativeInteger,
  }),
  supply: z.object({
    circulating: nonNegativeNumber,
    max: nonNegativeNumber.nullable(),
  }),
  blockReward: nonNegativeNumber,
  stakingReward: nonNegativeNumber,
  avgBlockTime: nonNegativeNumber,
  txCount24h: nonNegativeInteger,
  totalValueTransferred24h: nonNegativeNumber,
  txCount30d: nonNegativeInteger,
  avgTxPerBlock30d: nonNegativeNumber,
  txTrend30d: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      count: nonNegativeInteger,
    })
  ),
  flow24h: z.array(
    z.object({
      hour: z.string().datetime(),
      blocks: nonNegativeInteger,
      txs: nonNegativeInteger,
    })
  ),
  newAddresses24h: nonNegativeInteger,
  newAddresses7d: nonNegativeInteger,
  totalTransactions: nonNegativeInteger,
  totalAddresses: nonNegativeInteger,
  masternodes: nonNegativeInteger.optional(),
  stakingWallets: nonNegativeInteger.optional(),
});

export const statsApiResponseSchema = apiSuccessSchema(statsDataSchema);

export type StatsDataContract = z.infer<typeof statsDataSchema>;
export type StatsApiResponse = z.infer<typeof statsApiResponseSchema>;


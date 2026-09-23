import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  banWaveAnalysisApiResponseSchema,
  masternodeApiResponseSchema,
  masternodeDistributionApiResponseSchema,
  masternodeEventsApiResponseSchema,
  masternodeHealthApiResponseSchema,
  masternodeNodesApiResponseSchema,
  masternodeSummaryApiResponseSchema,
  nodeInventoryApiResponseSchema,
  searchApiResponseSchema,
  statsApiResponseSchema,
} from '@defcon/shared/dist/contracts';

type OpenApiSchema = Record<string, unknown>;
type OpenApiSchemaConverter = (
  schema: unknown,
  options: { target: 'openApi3'; $refStrategy: 'none' }
) => OpenApiSchema;

// The converter's recursive generic return type exceeds TypeScript's depth
// limit for the nested PoSe schemas. Keep that third-party type boundary
// local; the Zod schemas remain the runtime source of truth.
const convertToOpenApiSchema = zodToJsonSchema as unknown as OpenApiSchemaConverter;

export type OpenApiContractName =
  | 'StatsApiResponse'
  | 'SearchApiResponse'
  | 'MasternodeApiResponse'
  | 'MasternodeSummaryApiResponse'
  | 'MasternodeDistributionApiResponse'
  | 'MasternodeNodesApiResponse'
  | 'NodeInventoryApiResponse'
  | 'MasternodeEventsApiResponse'
  | 'MasternodeHealthApiResponse'
  | 'BanWaveAnalysisApiResponse';

function toOpenApiSchema(schema: unknown): OpenApiSchema {
  return convertToOpenApiSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as OpenApiSchema;
}

/**
 * Runtime response contracts are the single source for these OpenAPI schemas.
 * Do not hand-edit copies of their fields in the OpenAPI document.
 */
export const openApiContractSchemas: Record<OpenApiContractName, OpenApiSchema> = {
  StatsApiResponse: toOpenApiSchema(statsApiResponseSchema),
  SearchApiResponse: toOpenApiSchema(searchApiResponseSchema),
  MasternodeApiResponse: toOpenApiSchema(masternodeApiResponseSchema),
  MasternodeSummaryApiResponse: toOpenApiSchema(masternodeSummaryApiResponseSchema),
  MasternodeDistributionApiResponse: toOpenApiSchema(masternodeDistributionApiResponseSchema),
  MasternodeNodesApiResponse: toOpenApiSchema(masternodeNodesApiResponseSchema),
  NodeInventoryApiResponse: toOpenApiSchema(nodeInventoryApiResponseSchema),
  MasternodeEventsApiResponse: toOpenApiSchema(masternodeEventsApiResponseSchema),
  MasternodeHealthApiResponse: toOpenApiSchema(masternodeHealthApiResponseSchema),
  BanWaveAnalysisApiResponse: toOpenApiSchema(banWaveAnalysisApiResponseSchema),
};

export function openApiContractRef(name: OpenApiContractName) {
  return `#/components/schemas/${name}`;
}

export function openApiSuccessResponse(name: OpenApiContractName) {
  return {
    description: 'Successful response',
    content: {
      'application/json': {
        schema: { $ref: openApiContractRef(name) },
      },
    },
  };
}

export type OpenApiHttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface OpenApiReference {
  $ref: string;
}

export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  additionalProperties?: boolean | OpenApiSchema;
  anyOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
}

export interface OpenApiParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, { schema?: OpenApiSchema }>;
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Array<OpenApiParameter | OpenApiReference>;
  responses: Record<string, OpenApiResponse>;
}

export type OpenApiPathItem = Partial<Record<OpenApiHttpMethod, OpenApiOperation>>;

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, OpenApiPathItem>;
  components?: {
    parameters?: Record<string, OpenApiParameter>;
    schemas?: Record<string, OpenApiSchema>;
  };
}

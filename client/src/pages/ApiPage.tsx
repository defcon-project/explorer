import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HiOutlineArrowPath,
  HiOutlineCheck,
  HiOutlineChevronDown,
  HiOutlineChevronRight,
  HiOutlineClipboardDocument,
  HiOutlineCodeBracket,
  HiOutlineDocumentText,
  HiOutlineExclamationTriangle,
} from 'react-icons/hi2';
import { fetchOpenApiDocument } from '../services/api';
import type {
  OpenApiDocument,
  OpenApiHttpMethod,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiReference,
  OpenApiResponse,
  OpenApiSchema,
} from '../types/openapi';
import './PageStyles.css';
import './ApiPage.css';

const HTTP_METHODS: OpenApiHttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

type ApiEndpoint = {
  method: OpenApiHttpMethod;
  path: string;
  operation: OpenApiOperation;
};

type ApiGroup = {
  name: string;
  description?: string;
  endpoints: ApiEndpoint[];
};

function CopyButton({ text, label = 'Copy URL' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button type="button" onClick={handleCopy} className="copy-btn" title={label} aria-label={label}>
      {copied ? <><HiOutlineCheck /> Copied</> : <><HiOutlineClipboardDocument /> Copy</>}
    </button>
  );
}

function referenceName(reference: string): string {
  return reference.split('/').pop() || reference;
}

function resolveParameter(document: OpenApiDocument, parameter: OpenApiParameter | OpenApiReference): OpenApiParameter | null {
  if (!('$ref' in parameter)) return parameter;
  return document.components?.parameters?.[referenceName(parameter.$ref)] ?? null;
}

function schemaLabel(schema?: OpenApiSchema): string {
  if (!schema) return 'Documented response';
  if (schema.$ref) return referenceName(schema.$ref);

  const type = schema.type || (schema.oneOf ? 'one of' : schema.anyOf ? 'one of' : 'value');
  const details: string[] = [];
  if (schema.format) details.push(schema.format);
  if (schema.enum?.length) details.push(schema.enum.map(String).join(' | '));
  if (typeof schema.minimum === 'number' || typeof schema.maximum === 'number') {
    details.push(`${schema.minimum ?? '−∞'}–${schema.maximum ?? '∞'}`);
  }
  return details.length ? `${type} · ${details.join(' · ')}` : type;
}

function parameterDetail(parameter: OpenApiParameter): string | null {
  const values: string[] = [];
  if (parameter.description) values.push(parameter.description);
  if (parameter.schema?.default !== undefined) values.push(`default: ${String(parameter.schema.default)}`);
  return values.join(' · ') || null;
}

function getSuccessResponse(operation: OpenApiOperation): [string, OpenApiResponse] | null {
  if (operation.responses['200']) return ['200', operation.responses['200']];
  return Object.entries(operation.responses).find(([status]) => status.startsWith('2')) ?? null;
}

function responseSchema(response: OpenApiResponse | null): OpenApiSchema | undefined {
  return response?.content?.['application/json']?.schema;
}

function responseDefinition(document: OpenApiDocument, schema?: OpenApiSchema): OpenApiSchema | null {
  if (!schema) return null;
  if (!schema.$ref) return schema;
  const definition = document.components?.schemas?.[referenceName(schema.$ref)];
  return definition ? { $ref: schema.$ref, ...definition } : schema;
}

function buildGroups(document: OpenApiDocument): ApiGroup[] {
  const groups = new Map<string, ApiGroup>();
  for (const tag of document.tags ?? []) {
    groups.set(tag.name, { name: tag.name, description: tag.description, endpoints: [] });
  }

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const tagNames = operation.tags?.length ? operation.tags : ['Other'];
      for (const tagName of tagNames) {
        const group = groups.get(tagName) || { name: tagName, endpoints: [] };
        group.endpoints.push({ method, path, operation });
        groups.set(tagName, group);
      }
    }
  }

  return Array.from(groups.values()).filter((group) => group.endpoints.length > 0);
}

function ParameterList({ title, parameters }: { title: string; parameters: OpenApiParameter[] }) {
  return (
    <div className="api-params">
      <div className="api-params-title">{title}</div>
      {parameters.map((parameter) => {
        const detail = parameterDetail(parameter);
        return (
          <div key={`${parameter.in}:${parameter.name}`} className="api-param-row">
            <code className="api-param-name">{parameter.name}</code>
            <span className="api-param-type">{schemaLabel(parameter.schema)}</span>
            {parameter.required && <span className="api-required">required</span>}
            {detail && <span className="api-param-desc">{detail}</span>}
          </div>
        );
      })}
    </div>
  );
}

function EndpointCard({ document, endpoint }: { document: OpenApiDocument; endpoint: ApiEndpoint }) {
  const [showContract, setShowContract] = useState(false);
  const parameters = (endpoint.operation.parameters ?? [])
    .map((parameter) => resolveParameter(document, parameter))
    .filter((parameter): parameter is OpenApiParameter => parameter !== null);
  const pathParameters = parameters.filter((parameter) => parameter.in === 'path');
  const queryParameters = parameters.filter((parameter) => parameter.in === 'query');
  const successResponse = getSuccessResponse(endpoint.operation);
  const schema = responseSchema(successResponse?.[1] ?? null);
  const definition = responseDefinition(document, schema);
  const absoluteUrl = `${window.location.origin}${endpoint.path}`;

  return (
    <article className="api-endpoint">
      <div className="api-endpoint-header">
        <span className={`api-method api-method-${endpoint.method}`}>{endpoint.method.toUpperCase()}</span>
        <code className="api-path">{endpoint.path}</code>
        <CopyButton text={absoluteUrl} label={`Copy ${endpoint.path}`} />
      </div>
      <p className="api-desc">{endpoint.operation.description || endpoint.operation.summary || 'Documented API endpoint.'}</p>

      {pathParameters.length > 0 && <ParameterList title="Path parameters" parameters={pathParameters} />}
      {queryParameters.length > 0 && <ParameterList title="Query parameters" parameters={queryParameters} />}

      {successResponse && (
        <div className="api-response">
          <div className="api-response-summary">
            <span className="api-response-status">{successResponse[0]}</span>
            <span>{successResponse[1].description || 'Successful response'}</span>
            {schema && <code>{schemaLabel(schema)}</code>}
          </div>
          {definition && (
            <button
              className="api-toggle-btn"
              type="button"
              onClick={() => setShowContract((visible) => !visible)}
              aria-expanded={showContract}
            >
              {showContract ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              Response contract ({successResponse[0]})
            </button>
          )}
          {showContract && definition && (
            <div className="api-code-block">
              <pre>{JSON.stringify(definition, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function ApiPage() {
  const [requestedTag, setRequestedTag] = useState<string | null>(null);
  const { data: document, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['docs', 'openapi'],
    queryFn: fetchOpenApiDocument,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const groups = useMemo(() => (document ? buildGroups(document) : []), [document]);
  const activeTag = groups.some((group) => group.name === requestedTag) ? requestedTag : groups[0]?.name ?? null;
  const activeGroup = groups.find((group) => group.name === activeTag);
  const endpointCount = new Set(
    groups.flatMap((group) => group.endpoints.map((endpoint) => `${endpoint.method}:${endpoint.path}`)),
  ).size;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const specPath = '/api/docs/openapi.json';

  return (
    <div className="fade-in api-page">
      <section className="api-docs-hero">
        <div>
          <span className="api-kicker"><HiOutlineDocumentText /> Live API reference</span>
          <h1 className="page-title"><HiOutlineCodeBracket /> API Documentation</h1>
          <p className="page-subtitle">
            {document?.info.description || 'Public explorer endpoints generated from the live OpenAPI contract.'}
          </p>
        </div>
        <div className="api-hero-actions">
          {document && (
            <div className="api-doc-stats" aria-label="API document summary">
              <span>{endpointCount} endpoints</span>
              <span>OpenAPI {document.openapi}</span>
              <span>v{document.info.version}</span>
            </div>
          )}
          <div className="api-spec-actions">
            <a className="api-spec-link" href={specPath} target="_blank" rel="noreferrer">
              <HiOutlineDocumentText /> OpenAPI JSON
            </a>
            <CopyButton text={`${origin}${specPath}`} label="Copy OpenAPI URL" />
            <button className="api-refresh-btn" type="button" onClick={() => refetch()} disabled={isFetching}>
              <HiOutlineArrowPath className={isFetching ? 'spin' : undefined} />
              {isFetching ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </div>
      </section>

      <div className="api-base-url">
        <span>Same-origin base</span>
        <code>{origin || '/'}</code>
      </div>

      {isLoading && (
        <section className="card api-state" role="status">
          <HiOutlineArrowPath className="spin" /> Loading the live API contract…
        </section>
      )}

      {error && !document && (
        <section className="card api-state api-state-error" role="alert">
          <HiOutlineExclamationTriangle />
          <div>
            <strong>The API reference is temporarily unavailable.</strong>
            <p>{error instanceof Error ? error.message : 'Please retry in a moment.'}</p>
          </div>
          <button className="button" type="button" onClick={() => refetch()}>Retry</button>
        </section>
      )}

      {document && activeGroup && (
        <>
          <div className="api-tab-nav" role="tablist" aria-label="API endpoint categories">
            {groups.map((group) => (
              <button
                key={group.name}
                className={`api-tab-btn ${group.name === activeGroup.name ? 'active' : ''}`}
                type="button"
                role="tab"
                aria-selected={group.name === activeGroup.name}
                onClick={() => setRequestedTag(group.name)}
              >
                {group.name}
                <span>{group.endpoints.length}</span>
              </button>
            ))}
          </div>

          <section className="card api-contract-card" role="tabpanel">
            <div className="api-group-heading">
              <div>
                <p className="api-kicker">{activeGroup.endpoints.length} documented endpoint{activeGroup.endpoints.length === 1 ? '' : 's'}</p>
                <h2>{activeGroup.name}</h2>
                {activeGroup.description && <p>{activeGroup.description}</p>}
              </div>
              <span className="api-source-note">Source: live OpenAPI contract</span>
            </div>
            <div className="api-endpoint-list">
              {activeGroup.endpoints.map((endpoint) => (
                <EndpointCard key={`${endpoint.method}:${endpoint.path}`} document={document} endpoint={endpoint} />
              ))}
            </div>
          </section>
        </>
      )}

      <div className="api-rate-limit">
        <strong>Rate limiting:</strong> Public API requests share a limit of <strong>1200 requests per minute</strong> per IP address.
        Health check endpoints are excluded from the quota.
      </div>
    </div>
  );
}

import express from 'express';
import request from 'supertest';
import docsRoutes from '../src/routes/docs.routes';

describe('docs routes', () => {
  const app = express();
  app.use('/api/docs', docsRoutes);

  it('GET /api/docs/openapi.json returns OpenAPI metadata', async () => {
    const res = await request(app).get('/api/docs/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      openapi: '3.0.3',
      info: {
        title: 'DeFCoN Explorer API',
      },
    });
    expect(Object.keys(res.body.paths || {})).toContain('/api/health');
    expect(Object.keys(res.body.paths || {})).toContain('/api/docs/openapi.json');
  });

  it('binds high-value endpoint documentation to shared runtime response contracts', async () => {
    const res = await request(app).get('/api/docs/openapi.json');
    const contractPaths = [
      ['/api/stats', 'StatsApiResponse'],
      ['/api/search', 'SearchApiResponse'],
      ['/api/masternodes', 'MasternodeApiResponse'],
      ['/api/masternodes/summary', 'MasternodeSummaryApiResponse'],
      ['/api/masternodes/distribution', 'MasternodeDistributionApiResponse'],
      ['/api/masternodes/nodes', 'MasternodeNodesApiResponse'],
      ['/api/v1/node-inventory', 'NodeInventoryApiResponse'],
      ['/api/v1/masternodes/events', 'MasternodeEventsApiResponse'],
      ['/api/v1/masternodes/health', 'MasternodeHealthApiResponse'],
      ['/api/v1/masternodes/ban-waves', 'BanWaveAnalysisApiResponse'],
    ] as const;

    for (const [path, schemaName] of contractPaths) {
      expect(res.body.paths[path].get.responses[200].content['application/json'].schema).toEqual({
        $ref: `#/components/schemas/${schemaName}`,
      });
      expect(res.body.components.schemas[schemaName]).toMatchObject({
        type: 'object',
        required: expect.arrayContaining(['success', 'data']),
      });
    }

    expect(res.body.components.schemas.StatsApiResponse.properties.data.properties.blockHeight).toMatchObject({
      type: 'integer',
      minimum: 0,
    });
    expect(res.body.components.schemas.SearchApiResponse.properties.data.anyOf).toHaveLength(3);
    expect(res.body.components.schemas.NodeInventoryApiResponse.properties.data.properties.nodes.type).toBe('array');
    expect(res.body.components.schemas.BanWaveAnalysisApiResponse.properties.data.properties.timeline.type).toBe('array');
  });
});

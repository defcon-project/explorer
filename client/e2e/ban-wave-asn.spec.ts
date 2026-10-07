import { expect, test } from '@playwright/test';
import { stubApi } from './apiStub';
test('wave ASN concentration includes missing coverage and a correlation caveat @smoke', async ({ page }) => {
  const at = new Date().toISOString();
  await stubApi(page, { '/api/v1/masternodes/ban-waves': { success: true, data: {
    generatedAt: at, rpcAvailable: false, kpis: {}, trackedNodes: [], timeline: [], timelineModes: {},
    waveBands: [], waves: [{ id: 'wave-a', startedAt: at, endedAt: at, durationSeconds: 0,
      totalNodes: 3, stillBannedCount: 3, recoveredCount: 0, uniqueCountries: 0, uniqueIps: 3,
      uniqueOperators: 0, countries: [], severity: 'low', severityScore: 3, versions: [], nodes: [],
      asnKnownNodes: 2, asnUnknownNodes: 1,
      asnClusters: [{ asn: 64500, organization: 'Example network', nodes: 2, sharePct: 66.7 }] }] } } });
  await page.goto('/ban-detection');
  await expect(page.locator('.bd-wave-head')).toContainText('2 nodes on AS64500');
  await page.locator('.bd-wave-head').click();
  await expect(page.locator('.bd-wave-asn')).toContainText('2 affected nodes share AS64500');
  await expect(page.locator('.bd-wave-asn')).toContainText('2 known, 1 unknown');
  await expect(page.locator('.bd-wave-asn')).toContainText('correlation, not proof');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

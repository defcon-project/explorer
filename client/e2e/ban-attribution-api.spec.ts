import { expect, test } from '@playwright/test';
import { openApiDocument } from '../../server/src/docs/openapi';
import { stubApi } from './apiStub';

test('BANNED_BY documentation exposes the actual proof and unknown contracts @smoke', async ({ page }) => {
  const path = '/api/v1/masternodes/ban-attribution';
  await stubApi(page, {
    '/api/docs/openapi.json': {
      ...openApiDocument,
      paths: { [path]: openApiDocument.paths[path] },
    },
  });
  await page.goto('/about');
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'API', exact: true }).click();
  await expect(page.getByLabel('API document summary')).toContainText('1 endpoints');
  const endpoint = page.locator('.api-endpoint').filter({ hasText: path });
  await expect(endpoint).toBeVisible();
  await expect(endpoint.getByText('proTxHash', { exact: true })).toBeVisible();
  await expect(endpoint.getByText('banHeight', { exact: true })).toBeVisible();
  await expect(endpoint.getByText('blockHash', { exact: true })).toBeVisible();
  await expect(endpoint.getByText('required', { exact: true })).toHaveCount(2);
  await endpoint.getByRole('button', { name: 'Response contract (200)' }).click();
  const contract = endpoint.locator('.api-code-block');
  await expect(contract).toContainText('BanAttributionApiResponse');
  await expect(contract).toContainText('chain_verified_penalty');
  await expect(contract).toContainText('observerCount');
  await expect(contract).toContainText('read_invalidated');
});

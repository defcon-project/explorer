import { expect, test } from '@playwright/test';
import { stubApi } from './apiStub';

function fixture(nodes = 100, price = true) {
  return {
    '/api/stats': { success: true, data: { blockReward: 12, stakingReward: 2, avgBlockTime: 150, masternodes: nodes, supply: { circulating: 1000000 } } },
    '/api/coin': { success: true, data: { INITIAL_REWARD: 10, MASTERNODE_COLLATERAL: 1000, BLOCK_TIME_SECONDS: 150 } },
    '/api/masternodes/summary': { success: true, data: { total: nodes + 20, enabled: nodes, poseBanned: 20 } },
    '/api/market': { success: true, data: { available: price, price: price ? { usd: 2 } : null } },
  };
}

test('monthly DFCN rewards and payment rhythm reflect existing and added nodes @smoke', async ({ page }, testInfo) => {
  await stubApi(page, fixture());
  await page.goto('/mining');
  const monthly = page.locator('.rewards-income-card--monthly');
  await expect(monthly.locator('.stat-value')).toHaveText('1,728.00 DFCN');
  await expect(monthly.locator('.rewards-income-dfcn')).toContainText('$3,456.00');
  await expect(page.locator('.mn-reward-rhythm')).toContainText('4h 10m');
  await page.getByRole('button', { name: '10', exact: true }).click();
  await expect(monthly.locator('.stat-value')).toHaveText('17,280.00 DFCN');
  await page.getByRole('button', { name: 'Add new nodes', exact: true }).click();
  await expect(monthly.locator('.stat-value')).toHaveText('15,709.09 DFCN');
  await expect(page.locator('.mn-income-baseline')).toContainText('110 nodes sharing rewards');
  await expect(page.locator('.mn-reward-rhythm')).toContainText('4h 35m');
  await expect(page.locator('.mn-reward-rhythm')).toContainText('1,570.9');
  await expect(page.getByRole('slider')).toHaveAttribute('max', '10');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('rewards.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('DFCN estimates remain available without a market price @smoke', async ({ page }) => {
  await stubApi(page, fixture(100, false));
  await page.goto('/mining');
  await expect(page.locator('.rewards-income-card--monthly .stat-value')).toHaveText('1,728.00 DFCN');
  await expect(page.locator('.rewards-income-dfcn')).toHaveCount(0);
});

test('zero active nodes cannot claim the entire reward pool @smoke', async ({ page }) => {
  await stubApi(page, fixture(0));
  await page.goto('/mining');
  await expect(page.locator('.rewards-income-card--monthly .stat-value')).toHaveText('N/A');
  await page.getByRole('button', { name: 'Add new nodes', exact: true }).click();
  await expect(page.locator('.rewards-income-card--monthly .stat-value')).toHaveText('N/A');
  await expect(page.getByRole('slider')).toBeDisabled();
});

test('existing node selection cannot exceed current active membership @smoke', async ({ page }) => {
  await stubApi(page, fixture(2));
  await page.goto('/mining');
  await page.getByRole('button', { name: 'Add new nodes', exact: true }).click();
  await page.getByRole('button', { name: '10', exact: true }).click();
  await page.getByRole('button', { name: 'Existing nodes', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveValue('2');
  await expect(page.locator('.rewards-income-card--monthly .stat-value')).toHaveText('172,800.00 DFCN');
});

test('missing network data shows no numeric reward projection @smoke', async ({ page }) => {
  await stubApi(page);
  await page.goto('/mining');
  await expect(page.locator('.mn-income-baseline')).toContainText('Active network count unavailable');
  await expect(page.locator('.rewards-income-card--monthly .stat-value')).not.toContainText('DFCN');
});

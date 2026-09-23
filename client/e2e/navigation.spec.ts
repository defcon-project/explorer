import { expect, test } from '@playwright/test';
import { stubApi } from './apiStub';

test.beforeEach(async ({ page }) => {
  await stubApi(page);
});

test('desktop primary and dropdown navigation preserve their routes @smoke', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop navigation is covered in the desktop project.');

  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'About DeFCoN' })).toBeVisible();

  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await primaryNavigation.getByRole('link', { name: 'API', exact: true }).click();
  await expect(page).toHaveURL(/\/api$/);
  await expect(page.getByRole('heading', { name: 'API Documentation' })).toBeVisible();

  await primaryNavigation.getByRole('link', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { name: 'About DeFCoN' })).toBeVisible();

  await primaryNavigation.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(primaryNavigation.getByRole('menuitem', { name: 'Mempool', exact: true })).toHaveCount(0);
  await expect(primaryNavigation.getByRole('menuitem', { name: 'Wallet Distribution', exact: true })).toHaveCount(0);
  await primaryNavigation.getByRole('menuitem', { name: 'Latest Blocks', exact: true }).click();
  await expect(page).toHaveURL(/\/blocks$/);
  await expect(page.getByRole('heading', { name: 'Latest DeFCoN Blocks' })).toBeVisible();

  await primaryNavigation.getByRole('button', { name: 'Dev Tools', exact: true }).click();
  await primaryNavigation.getByRole('menuitem', { name: 'Node Inventory', exact: true }).click();
  await expect(page).toHaveURL(/\/devtools\/node-inventory$/);
  await expect(page.getByRole('heading', { name: 'Node Version & Chain Inventory' })).toBeVisible();
});

test('desktop header brand and navigation align with the dashboard shell @smoke', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'This is a desktop alignment check.');

  await page.goto('/');
  await expect(page.locator('.dashboard-hero')).toBeVisible();

  const [brandBox, navigationBox, dashboardBox] = await Promise.all([
    page.locator('.header-brand').boundingBox(),
    page.locator('.header-nav-shell').boundingBox(),
    page.locator('.dashboard-hero').boundingBox(),
  ]);
  if (!brandBox || !navigationBox || !dashboardBox) throw new Error('Header alignment elements were not rendered.');

  expect(Math.abs(brandBox.x - dashboardBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(navigationBox.x - dashboardBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs((navigationBox.x + navigationBox.width) - (dashboardBox.x + dashboardBox.width))).toBeLessThanOrEqual(1);
});

test('dashboard keeps duplicate network metrics out of the search hero @smoke', async ({ page }) => {
  await page.goto('/');

  const dashboardHero = page.locator('.dashboard-hero');
  await expect(dashboardHero).toBeVisible();
  await expect(dashboardHero.locator('.hero-metrics')).toHaveCount(0);
  await expect(dashboardHero.getByText('Market snapshot', { exact: true })).toHaveCount(0);
  for (const label of ['Indexed height', 'Last block', 'Peers', 'Masternodes']) {
    await expect(dashboardHero.getByText(label, { exact: true })).toHaveCount(0);
  }
});

test('dashboard marks a delayed market quote as stale @smoke', async ({ page }) => {
  await page.unroute('**/api/**');
  await stubApi(page, {
    '/api/market': {
      success: true,
      data: {
        available: true,
        source: 'qutrade',
        lastUpdatedAt: '2026-09-05T08:00:19.000Z',
        freshness: 'stale',
        ageSeconds: 42_000,
        price: {
          usd: 0.000008052,
          btc: null,
          change24h: -6.3,
          volume24h: null,
          marketCap: null,
        },
      },
    },
  });

  await page.goto('/');
  await expect(page.getByText(/Market data delayed/)).toBeVisible();
  await expect(page.getByText('Market data delayed · 11h 40m ago')).toBeVisible();
});

test('header does not report live when the indexed chain is delayed @smoke', async ({ page }) => {
  await page.unroute('**/api/**');
  await stubApi(page, {
    '/api/stats': {
      success: true,
      data: {
        blockHeight: 130_000,
        lastBlockTime: Math.floor(Date.now() / 1000) - 11 * 60,
        difficulty: 1,
        hashrate: 1,
        connections: 8,
        mempool: { size: 0, bytes: 0 },
        supply: { circulating: 1, max: null },
        blockReward: 1,
        stakingReward: 0,
        avgBlockTime: 150,
        totalTransactions: 1,
        totalAddresses: 1,
        masternodes: 1,
        stakingWallets: 1,
      },
    },
  });

  await page.goto('/');
  const status = page.locator('.status-chip-live').first();
  await expect(status).toContainText('Delayed');
  await expect(status).toHaveClass(/degraded/);
  await expect(status).toHaveAttribute('title', /Latest indexed block is .*old/);
});

test('mobile drawer exposes the same top-level navigation @smoke', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile navigation is covered in the mobile project.');

  await page.goto('/about');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(primaryNavigation.getByRole('link', { name: 'About', exact: true })).toBeVisible();

  await primaryNavigation.getByRole('link', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { name: 'About DeFCoN' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
});

test('theme preference is persisted after a reload @smoke', async ({ page }) => {
  await page.goto('/about');
  await page.evaluate(() => window.localStorage.removeItem('defcon-theme'));
  await page.reload();

  const before = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  const after = before === 'dark' ? 'light' : 'dark';

  await expect(page.locator('html')).toHaveAttribute('data-theme', after);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('defcon-theme'))).toBe(after);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', after);
});

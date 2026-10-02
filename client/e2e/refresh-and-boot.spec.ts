import { expect, test } from '@playwright/test';
import { renderBootData } from '../../server/src/utils/bootData';
import { stubApi } from './apiStub';

for (const [path, endpoint] of [['/blocks', '/api/blocks'], ['/txs', '/api/txs'], ['/mempool', '/api/mempool']]) {
  test(`fallback polling refreshes ${path} without WebSocket @smoke`, async ({ page }) => {
    await page.clock.install();
    await page.routeWebSocket('**/ws', (socket) => socket.close());
    await stubApi(page);
    let requests = 0;
    await page.route(`**${endpoint}?*`, (route) => {
      requests += 1;
      return route.fulfill({ json: { success: true, data: path === '/mempool'
        ? { info: { size: 0, bytes: 0 }, txs: [] } : [], cursor: { hasMore: false } } });
    });
    await page.goto(path);
    await expect.poll(() => requests).toBeGreaterThan(0);
    await page.clock.runFor(100);
    const initial = requests;
    await page.clock.runFor(15000);
    await expect.poll(() => requests).toBeGreaterThan(initial);
  });
}

test('production-style CSP allows inert preload data to seed the real app @smoke', async ({ page }) => {
  await stubApi(page, {
    '/api/coin': { success: true, data: { INITIAL_REWARD: 10, MASTERNODE_COLLATERAL: 1000, BLOCK_TIME_SECONDS: 150 } },
  });
  await page.route('**/mining', async (route) => {
    const response = await route.fetch();
    const boot = renderBootData({ stats: {
      masternodes: 321, blockReward: 12, stakingReward: 2, avgBlockTime: 150,
      supply: { circulating: 1000000 },
      label: '</script><script>window.BOOT_INJECTED=true</script>',
    } });
    await route.fulfill({ response, headers: { ...response.headers(),
      'content-security-policy': "script-src 'self' https://www.googletagmanager.com" },
      body: (await response.text()).replace('</head>', `${boot}</head>`) });
  });
  await page.goto('/mining');
  await expect(page.locator('.rewards-kpi--mn .stat-value')).toHaveText('321');
  await expect(page.locator('#deftrack-boot')).toHaveCount(0);
  expect(await page.evaluate(() => 'BOOT_INJECTED' in window)).toBe(false);
});

test('malformed preload data does not prevent normal API rendering @smoke', async ({ page }) => {
  await stubApi(page, {
    '/api/stats': { success: true, data: { masternodes: 123, blockReward: 12, avgBlockTime: 150 } },
  });
  await page.route('**/mining', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('</head>',
      '<script type="application/json" id="deftrack-boot">{invalid</script></head>') });
  });
  await page.goto('/mining');
  await expect(page.locator('.rewards-kpi--mn .stat-value')).toHaveText('123');
});

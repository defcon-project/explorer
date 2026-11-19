import { expect, test, type Page } from '@playwright/test';
import { stubApi } from './apiStub';

const path = '/api/v1/masternodes/ban-waves';
const NODE_COUNT = 60;
const REPEATED = 20;

function proTx(index: number): string {
  return index.toString(16).padStart(64, '0');
}

/**
 * 60 affected nodes, the first 20 banned twice; the server sends them most repeats first. Node 4 has
 * a long IPv6 service and node 1 is no longer registered: the widest cells the table can get.
 */
function fixture() {
  const now = new Date();
  const activation = new Date(now.getTime() - 3_600_000);
  const point = { bucket: activation.toISOString(), timestamp: Math.floor(activation.getTime() / 1000), waveBans: 0, isolatedBans: 2, recovered: 1, stillBanned: 1, total: 2, cumulative: 2 };
  return {
    generatedAt: now.toISOString(), rpcAvailable: true, dataStatus: 'fresh', bucket: '15min',
    analysisScope: { kind: 'q60', from: activation.toISOString(), activatedAt: activation.toISOString(), activationHeight: 144888, historyLimited: false, unclassifiedEvents: 0 },
    registeredTotal: 217, currentValid: 166, currentPoseBanned: 51, currentPosePenalty: 2,
    kpis: { windowWaveCount: 0, windowLargestWave: 0, meanTimeBetweenWavesSec: null },
    timeline: [point], timelineModes: { fresh: [point], recovered: [point], still: [point], all: [point] }, waveBands: [], waves: [],
    trackedNodes: Array.from({ length: NODE_COUNT }, (_, i) => ({
      nodeId: `node-${i + 1}`,
      proTxHash: proTx(i + 1),
      service: i === 3 ? '[2001:db8:85a3:1234:5678:8a2e:370:7334]:8192' : `198.51.100.${i + 1}:8192`,
      banCount: i < REPEATED ? 2 : 1,
      lastBanAt: now.toISOString(),
      lastBanHeight: 145000 + i,
      recoveredAt: null,
      currentStatus: i === 0 ? null : 'POSE_BANNED',
      currentPenalty: 220,
    })),
  };
}

async function open(page: Page, url = '/ban-detection') {
  await stubApi(page, { [path]: { success: true, data: fixture() } });
  await page.goto(url);
  await expect(page.locator('.bd-node-panel tbody tr').first()).toBeVisible();
}

/** Bottom edge of the sticky section menu in the viewport. */
async function menuBottom(page: Page): Promise<number> {
  const box = await page.getByRole('navigation', { name: 'Page sections' }).boundingBox();
  return box ? box.y + box.height : Number.NaN;
}

async function topOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().top);
}

test('the section menu stays below the site header and each link lands below it @smoke', async ({ page }) => {
  await open(page);
  const menu = page.getByRole('navigation', { name: 'Page sections' });
  const links = menu.getByRole('link');
  await expect(links).toHaveText(['Overview', 'Nodes', 'Diagnosis', 'Waves']);
  for (const [name, id] of [['Overview', 'overview'], ['Nodes', 'nodes'], ['Diagnosis', 'diagnosis'], ['Waves', 'waves']]) {
    await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute('href', `#${id}`);
  }
  const headerHeight = (await page.locator('header.header').boundingBox())!.height;

  // The node table is in the middle of the page: the jump puts its top just below the menu.
  await menu.getByRole('link', { name: 'Nodes', exact: true }).click();
  await expect(page).toHaveURL(/\/ban-detection#nodes$/);
  await expect.poll(async () => Math.abs((await menu.boundingBox())!.y - headerHeight)).toBeLessThanOrEqual(1);
  const nodesTop = await topOf(page, '#nodes');
  const bottom = await menuBottom(page);
  expect(nodesTop).toBeGreaterThanOrEqual(bottom);
  expect(nodesTop).toBeLessThanOrEqual(bottom + 24);

  // Near the end of the page a section may not reach the menu, but it is never hidden under it.
  for (const [name, id] of [['Diagnosis', 'diagnosis'], ['Waves', 'waves'], ['Overview', 'overview']]) {
    await menu.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(page.locator(`#${id}`)).toBeInViewport();
    expect(await topOf(page, `#${id}`)).toBeGreaterThanOrEqual(await menuBottom(page));
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a section link keeps the node search in the address @smoke', async ({ page }) => {
  await open(page, '/ban-detection?node=198.51.100.7');
  await expect(page.locator('.bd-node-panel tbody tr')).toHaveCount(1);
  await page.getByRole('navigation', { name: 'Page sections' }).getByRole('link', { name: 'Waves', exact: true }).click();
  await expect(page).toHaveURL(/\/ban-detection\?node=198\.51\.100\.7#waves$/);
  await expect(page.getByLabel('Find node')).toHaveValue('198.51.100.7');
  await expect(page.locator('.bd-node-panel tbody tr')).toHaveCount(1);
});

test('the affected nodes table shows 25 rows a page; a new search, filter or period starts on page 1 @smoke', async ({ page }) => {
  await open(page);
  const rows = page.locator('.bd-node-panel tbody tr');
  const pager = page.getByRole('navigation', { name: 'Affected node pages' });
  const label = pager.locator('.pager-label');

  await expect(rows).toHaveCount(25);
  await expect(rows.first()).toContainText('198.51.100.1:8192');
  await expect(label).toHaveText('Page 1 of 3');

  // The pager sits under the table: the next page brings the table's top back below the menu.
  await pager.scrollIntoViewIfNeeded();
  await pager.getByRole('button', { name: 'Next page' }).click();
  await expect(label).toHaveText('Page 2 of 3');
  await expect(rows).toHaveCount(25);
  await expect(rows.first()).toContainText('198.51.100.26:8192');
  await expect.poll(async () => (await topOf(page, '#nodes')) - (await menuBottom(page))).toBeGreaterThanOrEqual(0);
  expect((await topOf(page, '#nodes')) - (await menuBottom(page))).toBeLessThanOrEqual(24);

  await pager.getByRole('button', { name: 'Last page' }).click();
  await expect(label).toHaveText('Page 3 of 3');
  await expect(rows).toHaveCount(NODE_COUNT - 50);
  await expect(rows.first()).toContainText('198.51.100.51:8192');

  // Repeated bans only: 20 rows fit on one page, so the pager goes away.
  await page.getByLabel('Repeated bans only').check();
  await expect(rows).toHaveCount(REPEATED);
  await expect(pager).toHaveCount(0);
  // Back to every node: page 1 again, not the page left before the filter.
  await page.getByLabel('Repeated bans only').uncheck();
  await expect(label).toHaveText('Page 1 of 3');
  await expect(rows.first()).toContainText('198.51.100.1:8192');

  await pager.getByRole('button', { name: 'Next page' }).click();
  await expect(label).toHaveText('Page 2 of 3');
  await page.getByLabel('Find node').fill('198.51.100.3');
  // 198.51.100.3 and 198.51.100.30–39.
  await expect(rows).toHaveCount(11);
  await expect(rows.first()).toContainText('198.51.100.3:8192');
  await page.getByLabel('Find node').fill('');
  await expect(label).toHaveText('Page 1 of 3');

  await pager.getByRole('button', { name: 'Next page' }).click();
  await expect(label).toHaveText('Page 2 of 3');
  await page.getByRole('tab', { name: '24h', exact: true }).click();
  await expect(label).toHaveText('Page 1 of 3');
});

test('when a refresh brings fewer nodes, the table moves to the last page that still exists @smoke', async ({ page }) => {
  await open(page);
  const rows = page.locator('.bd-node-panel tbody tr');
  const pager = page.getByRole('navigation', { name: 'Affected node pages' });
  const label = pager.locator('.pager-label');
  await pager.getByRole('button', { name: 'Last page' }).click();
  await expect(label).toHaveText('Page 3 of 3');

  // Old events leave a rolling window: the next answer has 30 nodes, two pages.
  const smaller = fixture();
  smaller.trackedNodes = smaller.trackedNodes.slice(0, 30);
  await page.route(`**${path}*`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: smaller }),
  }));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(label).toHaveText('Page 2 of 2');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('198.51.100.26:8192');
});

test('ban evidence still opens from a later page of the table @smoke', async ({ page }) => {
  // A short window: the panel taking focus would otherwise come to rest under the sticky menu.
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 400 });
  await open(page);
  const rows = page.locator('.bd-node-panel tbody tr');
  const pager = page.getByRole('navigation', { name: 'Affected node pages' });
  await pager.getByRole('button', { name: 'Next page' }).click();
  await expect(rows.first()).toContainText('198.51.100.26:8192');
  await rows.first().getByRole('button', { name: 'Ban evidence' }).click();
  await expect(page).toHaveURL(new RegExp(`node=${proTx(26)}&ban=145025$`));
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('198.51.100.26:8192');
  // The evidence panel takes focus and comes into view, not under the sticky section menu.
  const evidence = page.getByRole('region', { name: 'Historical ban attribution' });
  await expect(evidence).toBeFocused();
  await expect(evidence).toBeInViewport();
  expect(await topOf(page, '.banned-by-panel')).toBeGreaterThanOrEqual(await menuBottom(page));
});

test('the table header sticks on wide screens; narrow screens scroll the table sideways, not the page @smoke', async ({ page }) => {
  const wide = (page.viewportSize()?.width ?? 0) > 1080;
  // The narrowest wide screen: the table has no inner scroll box there and must still fit.
  if (wide) await page.setViewportSize({ width: 1081, height: 720 });
  await open(page);
  const box = await page.locator('.bd-node-panel .mnh-table-wrap').evaluate((element) => ({
    scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
  }));
  // Scroll a third of the way into the table.
  await page.evaluate(() => {
    const table = document.querySelector('.bd-node-panel table')!;
    const rect = table.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + rect.top + rect.height / 3);
  });
  if (wide) {
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    const head = page.locator('.bd-node-panel thead th:first-child');
    expect(Math.abs((await topOf(page, '.bd-node-panel thead th:first-child')) - (await menuBottom(page)))).toBeLessThanOrEqual(1);
    // The stuck header is opaque, so the rows scrolling under it do not show through.
    const background = await head.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).toMatch(/^rgb\(/);
  } else {
    expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
  }
  // The section menu stays visible either way, and the page itself never scrolls sideways.
  await expect(page.getByRole('navigation', { name: 'Page sections' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

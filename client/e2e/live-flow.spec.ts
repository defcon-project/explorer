import { expect, test, type Locator, type Page } from '@playwright/test';
import { stubApi } from './apiStub';

// The home page's Live Flow chart: blocks and transactions per UTC hour on one shared axis, the hour
// that is still counting drawn lighter and named, a tooltip per hour, every number also listed in a
// table, and Recharts loaded only for the chart, after the rest of the page.

// A browser in Budapest (UTC+2 in September): its local hours would be two hours ahead.
test.use({ timezoneId: 'Europe/Budapest' });

const HOUR = 3600;
const LAST_HOUR = 1_788_609_600; // 2026-09-05 12:00:00 UTC, the newest bucket.
const IN_LAST_HOUR = new Date((LAST_HOUR + 20 * 60) * 1000); // 12:20 UTC: the 12:00 bucket is still filling.
const AFTER_LAST_HOUR = new Date((LAST_HOUR + 2 * HOUR + 30 * 60) * 1000); // 14:30 UTC: the data is older.
const END_OF_LAST_HOUR = new Date((LAST_HOUR + HOUR - 30) * 1000); // 12:59:30 UTC.
const SLOW_CLOCK = new Date((LAST_HOUR - 10 * 60) * 1000); // 11:50 UTC: this browser is 10+ minutes behind the server.

// 24 buckets, 13:00 the day before to 12:00. Most hours: 25 blocks, 60 transactions.
// 05:00: 10 blocks and 40 transactions; on a shared axis its transaction bar is 4 times its block bar.
// 09:00: the transaction count is missing. 12:00: 8 blocks, 17 transactions so far.
function flow(txs05 = 40) {
  return Array.from({ length: 24 }, (_, i) => {
    const start = LAST_HOUR - (23 - i) * HOUR;
    const utcHour = new Date(start * 1000).getUTCHours();
    const hour = new Date(start * 1000).toISOString().slice(0, 13) + ':00:00Z';
    if (utcHour === 5) return { hour, blocks: 10, txs: txs05 };
    if (utcHour === 9) return { hour, blocks: 25 };
    if (utcHour === 12) return { hour, blocks: 8, txs: 17 };
    return { hour, blocks: 25, txs: 60 };
  });
}
const FLOW = flow();
const INDEX_05 = FLOW.findIndex((point) => point.hour.endsWith('T05:00:00Z'));
const INDEX_11 = FLOW.findIndex((point) => point.hour.endsWith('T11:00:00Z'));

async function openHome(page: Page, now: Date, points = FLOW) {
  // A running clock from `now`: a frozen Date.now stops the chart's throttled mouse handler after
  // its first call, which no real browser does.
  await page.clock.install({ time: now });
  await stubApi(page, { '/api/dashboard/overview': { success: true, data: { stats: { flow24h: points }, blocks: [], txs: [] } } });
  await page.goto('/');
}

const chart = (page: Page) => page.locator('.flow-chart');
const blockBars = (page: Page) => chart(page).locator('.recharts-bar').nth(0).locator('.recharts-bar-rectangle path');
const txBars = (page: Page) => chart(page).locator('.recharts-bar').nth(1).locator('.recharts-bar-rectangle path');
const yLabels = (page: Page) => chart(page).locator('.recharts-yAxis .recharts-cartesian-axis-tick-value');

async function height(bar: Locator): Promise<number> {
  const box = await bar.boundingBox();
  if (!box) throw new Error('bar has no box');
  return box.height;
}

async function pointAt(page: Page, bar: Locator) {
  if (test.info().project.name.startsWith('mobile')) await bar.tap();
  else await bar.hover();
}

test('blocks and transactions share one y axis, and the hours are UTC @smoke', async ({ page }) => {
  await openHome(page, IN_LAST_HOUR);
  await expect(chart(page).locator('.recharts-surface')).toBeVisible();

  await expect(chart(page).locator('.recharts-yAxis')).toHaveCount(1);
  await expect(yLabels(page)).toHaveText(['0', '20', '40', '60']);
  // 23 hours with a transaction count, 24 with a block count (09:00 has no transaction bar).
  await expect(blockBars(page)).toHaveCount(24);
  await expect(txBars(page)).toHaveCount(23);
  const blocks05 = await height(blockBars(page).nth(INDEX_05));
  const txs05 = await height(txBars(page).nth(INDEX_05));
  // Each series scaled to its own peak would give 0.67 / 0.40 = 1.67 instead of 40 / 10.
  expect(txs05 / blocks05).toBeGreaterThan(3.8);
  expect(txs05 / blocks05).toBeLessThan(4.2);

  const ticks = await chart(page).locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').allTextContents();
  expect(ticks.length).toBeGreaterThan(3);
  for (const tick of ticks) expect(tick).toMatch(/^\d\d:00$/);
  // The newest hour is labelled 12:00, not Budapest's 14:00, and the labels are evenly spaced.
  expect(ticks[ticks.length - 1]).toBe('12:00');
  const hours = ticks.map((tick) => Number(tick.slice(0, 2)));
  const steps = new Set(hours.slice(1).map((hour, i) => (hour - hours[i] + 24) % 24));
  expect(steps.size).toBe(1);
  await expect(page.locator('.flow-legend')).toContainText('13:00 - 12:00 UTC');
});

test('the hour that is still counting is drawn lighter and named @smoke', async ({ page }) => {
  await openHome(page, IN_LAST_HOUR);
  await expect(chart(page).locator('.recharts-surface')).toBeVisible();

  await expect(blockBars(page).last()).toHaveAttribute('fill-opacity', '0.6');
  await expect(txBars(page).last()).toHaveAttribute('fill-opacity', '0.6');
  await expect(blockBars(page).nth(INDEX_05)).toHaveAttribute('fill-opacity', '1');
  await expect(page.locator('.flow-legend-current')).toHaveText('12:00 UTC still counting');

  const tooltip = chart(page).locator('.flow-tooltip');
  await pointAt(page, txBars(page).last());
  await expect(tooltip).toContainText('12:00–13:00 UTC · in progress');
  await expect(tooltip.locator('.flow-tooltip-row').nth(0)).toHaveText('8blocks');
  await expect(tooltip.locator('.flow-tooltip-row').nth(1)).toHaveText('17transactions');

  await pointAt(page, txBars(page).nth(INDEX_05));
  await expect(tooltip).toContainText('05:00–06:00 UTC');
  await expect(tooltip).not.toContainText('in progress');
  await expect(tooltip.locator('.flow-tooltip-row').nth(0)).toHaveText('10blocks');
  await expect(tooltip.locator('.flow-tooltip-row').nth(1)).toHaveText('40transactions');
});

test('when the newest bucket is an hour that has ended, no hour is marked as counting @smoke', async ({ page }) => {
  await openHome(page, AFTER_LAST_HOUR);
  await expect(chart(page).locator('.recharts-surface')).toBeVisible();

  await expect(blockBars(page).last()).toHaveAttribute('fill-opacity', '1');
  await expect(txBars(page).last()).toHaveAttribute('fill-opacity', '1');
  await expect(page.locator('.flow-legend-current')).toHaveCount(0);
});

test('a page left open past the hour stops marking it, without new data @smoke', async ({ page }) => {
  await openHome(page, END_OF_LAST_HOUR);
  await expect(page.locator('.flow-legend-current')).toHaveText('12:00 UTC still counting');
  await expect(txBars(page).last()).toHaveAttribute('fill-opacity', '0.6');

  await page.clock.runFor(2 * 60_000);
  await expect(page.locator('.flow-legend-current')).toHaveCount(0);
  await expect(txBars(page).last()).toHaveAttribute('fill-opacity', '1');
});

test('a browser clock behind the server still marks the newest hour, not the one before @smoke', async ({ page }) => {
  await openHome(page, SLOW_CLOCK);
  await expect(page.locator('.flow-legend-current')).toHaveText('12:00 UTC still counting');
  await expect(txBars(page).last()).toHaveAttribute('fill-opacity', '0.6');
  await expect(blockBars(page).nth(INDEX_11)).toHaveAttribute('fill-opacity', '1');
});

// One label style per axis: in full below 10,000, compact once the axis reaches it.
for (const [peak, labels] of [
  [9_876, ['0', '2.5K', '5K', '7.5K', '10K']],
  [12_345, ['0', '5K', '10K', '15K']],
  [123_456, ['0', '50K', '100K', '150K']],
] as const) {
  test(`with up to ${peak} transactions an hour every y label is whole and inside the chart @smoke`, async ({ page }) => {
    await openHome(page, IN_LAST_HOUR, flow(peak));
    const surface = chart(page).locator('.recharts-surface');
    await expect(surface).toBeVisible();
    await expect(yLabels(page)).toHaveText([...labels]);
    const svg = await surface.boundingBox();
    if (!svg) throw new Error('no chart');
    for (const label of await yLabels(page).all()) {
      const box = await label.boundingBox();
      if (!box) throw new Error('no label box');
      expect(box.x).toBeGreaterThanOrEqual(svg.x);
    }
  });
}

test('every hourly number is listed without hovering @smoke', async ({ page }) => {
  await openHome(page, IN_LAST_HOUR);
  const table = page.locator('.flow-table');
  const summary = table.locator('summary');
  await expect(summary).toHaveText('Hourly numbers');
  expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);

  await summary.click();
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(24);
  await expect(rows.first().locator('th')).toHaveText('13:00–14:00');
  await expect(rows.nth(INDEX_05).locator('td')).toHaveText(['10', '40']);
  // The missing transaction count stays unknown instead of reading as zero.
  await expect(rows.filter({ hasText: '09:00–10:00' }).locator('td')).toHaveText(['25', 'n/a']);
  await expect(rows.last().locator('th')).toHaveText('12:00–13:00 (in progress)');
  await expect(rows.last().locator('td')).toHaveText(['8', '17']);
});

test('the chart loads after the rest of the home page @smoke', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route('**/assets/LiveFlowChart-*.js', async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  await openHome(page, IN_LAST_HOUR);

  // Everything but the chart is on screen while its chunk is still on the way.
  await expect(page.locator('.flow-kpi').filter({ hasText: 'Blocks (24h)' }).locator('strong')).toHaveText('568');
  await expect(page.locator('.flow-chart-loading')).toHaveText('Loading chart...');
  await expect(page.locator('.flow-legend')).toContainText('12:00 UTC still counting');
  await expect.poll(() => requested).toBe(true);
  await expect(page.locator('.recharts-wrapper')).toHaveCount(0);

  release();
  await expect(chart(page).locator('.recharts-surface')).toBeVisible();
  await expect(page.locator('.flow-chart-loading')).toHaveCount(0);
});

test('a chart that cannot load leaves the rest of the home page working @smoke', async ({ page }) => {
  await page.route('**/assets/LiveFlowChart-*.js', (route) => route.abort());
  await openHome(page, IN_LAST_HOUR);

  // A missing chunk reloads the tab once (as a page chunk does); still missing, the card says so.
  const card = page.locator('.flow-card');
  await expect(card.getByRole('alert')).toContainText('The chart could not be loaded');
  await expect(card.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect(page.locator('.flow-kpi').filter({ hasText: 'Blocks (24h)' }).locator('strong')).toHaveText('568');
  await card.locator('.flow-table summary').click();
  await expect(card.locator('.flow-table tbody tr')).toHaveCount(24);
});

test('the chart stays inside its card on every screen @smoke', async ({ page }) => {
  await openHome(page, IN_LAST_HOUR);
  const surface = chart(page).locator('.recharts-surface');
  await expect(surface).toBeVisible();
  const card = await page.locator('.flow-card').boundingBox();
  const svg = await surface.boundingBox();
  if (!card || !svg) throw new Error('no layout');
  expect(svg.x).toBeGreaterThanOrEqual(card.x);
  expect(svg.x + svg.width).toBeLessThanOrEqual(card.x + card.width);
  // The newest hour's label is not cut off at the chart's right edge.
  const lastTick = await chart(page).locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').last().boundingBox();
  if (!lastTick) throw new Error('no tick');
  expect(lastTick.x + lastTick.width).toBeLessThanOrEqual(svg.x + svg.width);
  const viewport = page.viewportSize();
  if (viewport) expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);
});

import { expect, test, type Locator, type Page } from '@playwright/test';
import { stubApi } from './apiStub';

// "My masternodes" on the home page: only while something is starred, each starred node with its
// status in the current masternode list, the ones that need a look first, matched by proTxHash.

const FAVORITES_KEY = 'deftrack-fav-masternodes';
const OBSERVED_AT = '2026-11-14T10:00:00.000Z';
const ip = (i: number) => `203.0.113.${i}`;
const proTx = (i: number) => i.toString(16).padStart(64, 'a');

function node(i: number, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `node-${i}`, service: `${ip(i)}:9999`, ip: ip(i), port: 9999, status, protocol: 70242, lastSeen: null, activeSeconds: null,
    isTor: false, countryCode: 'DE', countryName: 'Germany', proTxHash: proTx(i), ownerAddress: null, payoutAddress: null,
    collateralAddress: null, registeredHeight: null, registeredAt: null, poseBanHeight: null, poseBanAt: null, collateralAmount: null,
    provider: 'Hetzner', providerSource: 'mmdb', providerTagCidr: null, providerTagSource: null, providerConfidence: null,
    providerEvidenceUrl: null, asn: null, asnOrg: null, ...overrides,
  };
}

// The longest IPv4 address and port there is: the band must show it whole beside the badge.
const LONGEST = '255.255.255.255:65535';
// Node 1 is listed with an upper-case proTxHash; node 4 is starred but not in the list at all.
const NODES = [
  node(1, 'ENABLED', { proTxHash: proTx(1).toUpperCase() }),
  node(2, 'POSE_PENALTY'),
  node(3, 'POSE_BANNED', { ip: '255.255.255.255', port: 65535, service: LONGEST }),
  node(5, 'ENABLED'),
  ...Array.from({ length: 12 }, (_, index) => node(220 + index, 'ENABLED')),
];
const snapshot = (nodes = NODES) => ({ success: true, data: { snapshotId: 's1', observedAt: OBSERVED_AT, total: nodes.length, nodes } });

/** The home page's answers; without `list` the masternode list fails like every unstubbed path. */
function api(list: Record<string, unknown> | null = snapshot()) {
  return {
    '/api/dashboard/overview': { success: true, data: { stats: {}, blocks: [], txs: [] } },
    ...(list ? { '/api/masternodes': list } : {}),
  };
}

async function star(page: Page, ids: string[]) {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [FAVORITES_KEY, JSON.stringify(ids)]);
}

const band = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'My masternodes' }) });
const items = (page: Page) => band(page).getByRole('list', { name: 'Starred masternodes' }).getByRole('listitem');
const fitsWindow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Whether every address (or shortened proTxHash) in the band is shown whole, not cut by the ellipsis. */
const addressesWhole = (page: Page) =>
  items(page).locator('.my-mn-service').evaluateAll((texts) => texts.every((text) => text.scrollWidth <= text.clientWidth));
/** Height in CSS pixels: every link in the band has to be at least 40 px tall to be easy to tap. */
const height = async (locator: Locator) => (await locator.boundingBox())!.height;

test('without a star the home page has no band and does not ask for the masternode list @smoke', async ({ page }) => {
  const listRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/masternodes') listRequests.push(request.url());
  });
  await stubApi(page, api());
  // The ROI tile asks for the masternode summary in the same render that would mount the band.
  const summaryRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/masternodes/summary');
  await page.goto('/');
  await summaryRequest;
  await expect(page.getByRole('heading', { name: 'Latest Blocks' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'My masternodes' })).toHaveCount(0);
  expect(listRequests).toEqual([]);
});

test('the band shows each starred node with its status, the troubled ones first, and links to its page @smoke', async ({ page }) => {
  await stubApi(page, api());
  await star(page, [proTx(1), proTx(2), proTx(3), proTx(4), proTx(5)]);
  await page.goto('/');

  await expect(items(page)).toHaveCount(5);
  // Banned, then not in the list, then under penalty, then the enabled ones in the order they were starred.
  await expect(items(page).locator('.my-mn-service')).toHaveText([LONGEST, 'aaaaaa...aaaaa4', `${ip(2)}:9999`, `${ip(1)}:9999`, `${ip(5)}:9999`]);
  await expect(items(page).locator('.badge')).toHaveText(['PoSe Banned', 'Not in the list', 'PoSe Penalty', 'Enabled', 'Enabled']);
  await expect(items(page).nth(0).locator('.badge')).toHaveClass(/\berror\b/);
  await expect(items(page).nth(2).locator('.badge')).toHaveClass(/\bwarning\b/);
  await expect(items(page).nth(3).locator('.badge')).toHaveClass(/\bsuccess\b/);
  await expect(items(page).nth(1).locator('a')).toHaveAttribute('href', `/masternode/${proTx(4)}`);
  await expect(items(page).nth(3).locator('a')).toHaveAttribute('href', `/masternode/${proTx(1)}`);
  await expect(band(page).locator('.my-mn-summary')).toHaveText('1 PoSe Banned · 1 Not in the list · 1 PoSe Penalty · 2 Enabled');
  // A count never breaks inside itself ("1" at the end of one line, "Enabled" on the next).
  expect(await band(page).locator('.my-mn-count').evaluateAll((counts) => counts.every((count) => count.getClientRects().length === 1))).toBe(true);
  await expect(band(page)).toContainText('Status from the masternode list of 2026-11-14 10:00:00 UTC.');
  await expect(band(page).getByRole('link', { name: 'Open My nodes' })).toHaveAttribute('href', '/masternodes?mine=1');
  await expect(band(page).getByText(/more in My nodes/)).toHaveCount(0);
  // The band sits between the figures and the latest lists, outside the figures.
  await expect(page.locator('.dashboard-hero').getByText('My masternodes')).toHaveCount(0);
  expect(await fitsWindow(page)).toBe(true);
  expect(await addressesWhole(page)).toBe(true);
  expect(await height(items(page).nth(3).locator('a'))).toBeGreaterThanOrEqual(40);
  expect(await height(band(page).getByRole('link', { name: 'Open My nodes' }))).toBeGreaterThanOrEqual(40);

  await items(page).nth(2).locator('a').click();
  await expect(page).toHaveURL(new RegExp(`/masternode/${proTx(2)}$`));
});

test('with more than eight stars the band shows eight and sends the rest to the table @smoke', async ({ page }) => {
  await stubApi(page, api());
  await star(page, Array.from({ length: 10 }, (_, index) => proTx(220 + index)));
  await page.goto('/');

  await expect(items(page)).toHaveCount(8);
  await expect(items(page).first().locator('.my-mn-service')).toHaveText(`${ip(220)}:9999`);
  await expect(band(page).locator('.my-mn-summary')).toHaveText('10 Enabled');
  const more = band(page).getByRole('link', { name: '2 more in My nodes' });
  await expect(more).toHaveAttribute('href', '/masternodes?mine=1');
  expect(await height(more)).toBeGreaterThanOrEqual(40);
  expect(await fitsWindow(page)).toBe(true);
  expect(await addressesWhole(page)).toBe(true);
});

test('when the masternode list fails the band says the status is unknown and still links each star @smoke', async ({ page }) => {
  await stubApi(page, api(null));
  await star(page, [proTx(2), proTx(3)]);
  await page.goto('/');

  const warning = band(page).locator('.state-panel[data-tone="warning"]');
  await expect(warning).toContainText('Status unavailable right now');
  await expect(warning).toContainText('The masternode list could not be loaded, so the status of your starred masternodes is unknown.');
  await expect(items(page).locator('.badge')).toHaveText(['Status unknown', 'Status unknown']);
  await expect(items(page).locator('.my-mn-service')).toHaveText(['aaaaaa...aaaaa2', 'aaaaaa...aaaaa3']);
  expect(await addressesWhole(page)).toBe(true);
  await expect(items(page).first().locator('a')).toHaveAttribute('href', `/masternode/${proTx(2)}`);
  await expect(band(page).locator('.my-mn-summary')).toHaveCount(0);
  await expect(band(page).getByText(/Status from the masternode list/)).toHaveCount(0);
});

test('when a refresh fails the band keeps the last status and says it is not current @smoke', async ({ page }) => {
  await page.clock.install({ time: new Date(OBSERVED_AT) });
  let calls = 0;
  await stubApi(page, api());
  // Registered after the stub, so it answers first: the first list loads, every later one fails.
  await page.route('**/api/masternodes', (route) => {
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot()) })
      : route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false }) });
  });
  await star(page, [proTx(3)]);
  await page.goto('/');
  await expect(items(page).locator('.badge')).toHaveText(['PoSe Banned']);

  // The list is asked for again every 90 seconds while the page is visible; one retry follows a failure.
  await page.clock.runFor(95_000);
  await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
  await page.clock.runFor(5_000);
  const warning = band(page).locator('.state-panel[data-tone="warning"]');
  await expect(warning).toContainText('Status may be out of date');
  await expect(warning).toContainText('The masternode list could not be refreshed; the status below is from the last list that loaded.');
  await expect(items(page).locator('.badge')).toHaveText(['PoSe Banned']);
  await expect(band(page)).toContainText('Status from the masternode list of 2026-11-14 10:00:00 UTC.');
});

test('the band follows the stars: removing the last one in another tab removes it @smoke', async ({ page, context }) => {
  await stubApi(page, api());
  await page.addInitScript(([key, value]) => {
    if (!window.sessionStorage.getItem('seeded')) {
      window.localStorage.setItem(key, value);
      window.sessionStorage.setItem('seeded', '1');
    }
  }, [FAVORITES_KEY, JSON.stringify([proTx(5)])]);
  await page.goto('/');
  await expect(items(page)).toHaveCount(1);

  const other = await context.newPage();
  await stubApi(other, api());
  await other.goto('/about');
  await other.evaluate((key) => window.localStorage.setItem(key, '[]'), FAVORITES_KEY);

  await expect(page.getByRole('heading', { name: 'My masternodes' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Latest Blocks' })).toBeVisible();
});

test('while the list loads the band says so, then shows the status @smoke', async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await stubApi(page, api());
  await page.route('**/api/masternodes', async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot()) });
  });
  await star(page, [proTx(2)]);
  await page.goto('/');

  await expect(band(page).locator('.state-panel')).toHaveText('Loading the status of your starred masternodes...');
  await expect(items(page)).toHaveCount(0);
  release();
  await expect(items(page).locator('.badge')).toHaveText(['PoSe Penalty']);
  await expect(band(page).locator('.state-panel')).toHaveCount(0);
});

test('with storage blocked the home page works without a band; a star made in this tab shows with a note @smoke', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
  });
  await stubApi(page, {
    ...api(),
    '/api/masternodes/summary': { success: true, data: { total: NODES.length, enabled: 14, poseBanned: 1, posePenalty: 1, countries: 1 } },
    '/api/masternodes/distribution': { success: true, data: { total: NODES.length, countries: [], providers: [] } },
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Latest Blocks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My masternodes' })).toHaveCount(0);

  // Star a node in the Masternodes table, then come back without reloading.
  await page.goto('/masternodes');
  await page.getByRole('button', { name: `Star ${ip(2)}:9999` }).click();
  await page.locator('a.header-brand').click();
  await expect(items(page).locator('.my-mn-service')).toHaveText([`${ip(2)}:9999`]);
  await expect(band(page)).toContainText('This browser does not allow saving here, so your stars are kept only until the page is reloaded or closed.');
});

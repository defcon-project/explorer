import { expect, test } from '@playwright/test';
import { stubApi } from './apiStub';

// The font- and style-related directives the server sends in production (helmet in
// server/src/index.ts). upgrade-insecure-requests is left out: it would move this plain-HTTP
// preview to HTTPS.
const PRODUCTION_FONT_CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
].join('; ');

test.beforeEach(async ({ page }) => {
  await stubApi(page);
});

test('the site fonts load from this origin under the production content security policy @smoke', async ({ page }) => {
  const externalFontRequests: string[] = [];
  page.on('request', (request) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) externalFontRequests.push(request.url());
  });
  const fontPolicyViolations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/.test(message.text()) && /font-src|style-src/.test(message.text())) {
      fontPolicyViolations.push(message.text());
    }
  });
  await page.route('**/about', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': PRODUCTION_FONT_CSP } });
  });

  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'About DeFCoN' })).toBeVisible();

  const fonts = await page.evaluate(async () => {
    const requested = ['500 16px "Space Grotesk Variable"', '400 16px "IBM Plex Mono"', '600 16px "IBM Plex Mono"'];
    const loaded = await Promise.all(requested.map(async (font) => {
      const faces = await document.fonts.load(font);
      return faces.filter((face) => face.status === 'loaded').map((face) => `${face.family.replace(/"/g, '')} ${face.weight}`);
    }));
    return { loaded, bodyFamily: getComputedStyle(document.body).fontFamily };
  });

  expect(fonts.loaded).toEqual([['Space Grotesk Variable 300 700'], ['IBM Plex Mono 400'], ['IBM Plex Mono 600']]);
  expect(fonts.bodyFamily.startsWith('"Space Grotesk Variable"')).toBe(true);
  expect(externalFontRequests).toEqual([]);
  expect(fontPolicyViolations).toEqual([]);
});

const delayedStats = () => ({
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
});

// The longest status labels leave the least room for the title next to them. Every case must
// fit on screen without sideways scrolling. Below 360px the block height moves to the menu while
// the status is not "Live", so the title stays on one line and the menu button keeps its size.
// At 360px beside "Disconnected" the title wraps and the menu button narrows, as it did with the
// previous system font. Beside "Delayed" the title has only about 2px to spare on Windows, and
// Linux Chromium rounds glyph widths differently and draws the block height about 3px wider, so
// there the title wraps too. At 360px the title may therefore take two lines, but never more, and
// it never runs into the status. The narrow-phone header is redesigned in a later change.
const NARROW_HEADER_CASES = [
  { width: 360, label: 'Delayed', roomy: false, heightInTopBar: true },
  { width: 360, label: 'Disconnected', roomy: false, heightInTopBar: true },
  { width: 320, label: 'Delayed', roomy: true, heightInTopBar: false },
  { width: 320, label: 'Disconnected', roomy: true, heightInTopBar: false },
];

const disconnectedSync = {
  success: true,
  data: { isRunning: false, lastSyncedHeight: 130_000, daemonHeight: -1, rpcConnected: false, blocksRemaining: 0, progress: 0, error: null },
};

for (const { width, label, roomy, heightInTopBar } of NARROW_HEADER_CASES) {
  test(`a ${width}px phone fits the header beside "${label}" @smoke`, async ({ page }) => {
    await page.unroute('**/api/**');
    await stubApi(page, label === 'Disconnected'
      ? { '/api/stats': delayedStats(), '/api/sync': disconnectedSync }
      : { '/api/stats': delayedStats() });
    await page.setViewportSize({ width, height: 780 });

    await page.goto('/');
    await expect(page.locator('.status-chip-live').first()).toContainText(label);
    const layout = await page.evaluate(async () => {
      await document.fonts.ready;
      const title = document.querySelector('.header-brand-title') as HTMLElement;
      const titleText = document.createRange();
      titleText.selectNodeContents(title);
      const actions = Array.from(document.querySelectorAll('.header-top-actions .status-chip, .header-top-actions button'))
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0);
      const heightChip = document.querySelector('.header-top-actions .status-chip-height')?.getBoundingClientRect();
      return {
        titleFont: getComputedStyle(title).fontFamily.split(',')[0],
        titleLines: title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight),
        titleTextRight: titleText.getBoundingClientRect().right,
        firstActionLeft: Math.min(...actions.map((box) => box.left)),
        lastActionRight: Math.max(...actions.map((box) => box.right)),
        menuWidth: (document.querySelector('.mobile-toggle') as HTMLElement).getBoundingClientRect().width,
        heightInTopBar: (heightChip?.width ?? 0) > 0,
        pageWidth: document.documentElement.scrollWidth,
      };
    });

    expect(layout.titleFont).toBe('"Space Grotesk Variable"');
    expect(layout.titleTextRight).toBeLessThanOrEqual(layout.firstActionLeft);
    expect(layout.lastActionRight).toBeLessThanOrEqual(width);
    expect(layout.pageWidth).toBe(width);
    expect(layout.heightInTopBar).toBe(heightInTopBar);
    if (roomy) {
      expect(layout.titleLines).toBeLessThan(1.5);
      expect(layout.menuWidth).toBeGreaterThanOrEqual(38);
    } else {
      expect(layout.titleLines).toBeLessThan(2.5);
    }
  });
}

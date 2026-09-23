import { expect, test } from '@playwright/test';
import { stubApi } from './apiStub';

const TEST_BLOCK_HASH = 'a'.repeat(64);
const timelinePoint = {
  bucket: '2026-09-05T12:00:00.000Z',
  timestamp: 1_788_609_600_000,
  waveBans: 4,
  isolatedBans: 1,
  recovered: 2,
  stillBanned: 2,
  total: 5,
  cumulative: 5,
};

const banWaveFixture = {
  success: true,
  data: {
    generatedAt: '2026-09-05T12:00:00.000Z',
    windowHours: 720,
    windowMinutes: 30,
    minNodes: 3,
    bucket: 'hour',
    rpcAvailable: true,
    currentPoseBanned: 2,
    currentPosePenalty: 1,
    currentValid: 160,
    registeredTotal: 163,
    freshDrops24h: 4,
    freshDropEvents24h: 4,
    observedAlreadyBanned24h: 0,
    kpis: {
      totalBans: 5,
      uniqueBannedNodes: 5,
      waveCount: 1,
      windowWaveCount: 1,
      nodesInWaves: 4,
      windowNodesInWaves: 4,
      largestWave: 4,
      windowLargestWave: 4,
      freshDrops24h: 4,
      freshDropEvents24h: 4,
      observedAlreadyBanned24h: 0,
      currentPoseBanned: 2,
      currentPosePenalty: 1,
      currentValid: 160,
      registeredTotal: 163,
      uniqueCountries: 2,
      meanTimeBetweenWavesSec: null,
    },
    timeline: [timelinePoint],
    timelineModes: {
      fresh: [timelinePoint],
      recovered: [timelinePoint],
      still: [timelinePoint],
      all: [timelinePoint],
    },
    eventBreakdown: {
      freshBans: 4,
      freshDropEvents24h: 4,
      allBanEvents: 5,
      poseBanHeightEvents: 5,
      historicalDropEvents: 5,
      recoveredEvents: 2,
      stillBannedEvents: 2,
      observedAlreadyBanned: 0,
      observedAlreadyBanned24h: 0,
      enabledToBanned: 4,
      penaltyToBanned: 0,
      uniqueFreshNodes: 4,
      uniqueAllNodes: 5,
    },
    waveBands: [],
    countryBreakdown: [],
    providerBreakdown: [],
    providerSourceBreakdown: [],
    reliabilityCohorts: {
      totalLiveNodes: 163,
      never: 158,
      once: 3,
      repeat2to3: 2,
      repeat4plus: 0,
    },
    providerReliability: [],
    waves: [],
  },
};

test('SearchV2 submits a query and renders the matching block route @smoke', async ({ page }) => {
  await stubApi(page, {
    '/api/search': {
      success: true,
      data: {
        type: 'block',
        matchedBy: 'height',
        result: { height: 123_456, hash: TEST_BLOCK_HASH },
      },
    },
  });

  await page.goto('/searchv2');
  await page.getByPlaceholder('Search by tx hash or address').fill('123456');
  await page.getByRole('button', { name: 'Analyze Flow' }).click();

  await expect(page).toHaveURL(/\/searchv2\?q=123456$/);
  await expect(page.getByRole('heading', { name: 'Block match found' })).toBeVisible();
  await expect(page.getByText('123,456')).toBeVisible();
});

test('PoSe timeline controls update a rendered chart state @smoke', async ({ page }) => {
  await stubApi(page, { '/api/v1/masternodes/ban-waves': banWaveFixture });

  await page.goto('/ban-detection');
  await expect(page.getByRole('heading', { name: 'Ban Detection' })).toBeVisible();
  await expect(page.locator('.recharts-responsive-container').first()).toBeVisible();

  const timeWindow = page.getByRole('tablist', { name: 'Time window' });
  await timeWindow.getByRole('tab', { name: '7 days' }).click();
  await expect(timeWindow.getByRole('tab', { name: '7 days' })).toHaveAttribute('aria-selected', 'true');

  const timelineMode = page.getByRole('tablist', { name: 'Timeline mode' });
  await timelineMode.getByRole('tab', { name: 'Recovered' }).click();
  await expect(timelineMode.getByRole('tab', { name: 'Recovered' })).toHaveAttribute('aria-selected', 'true');
});

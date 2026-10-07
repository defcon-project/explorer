import { expect, test } from '@playwright/test';
import { stubApi } from './apiStub';

const chainPath = '/api/v1/masternodes/pose-chain';
const banPath = '/api/v1/masternodes/ban-waves';
function banData() {
  const from = new Date(Date.now() - 3600000).toISOString();
  return { generatedAt: new Date().toISOString(), rpcAvailable: true, dataStatus: 'fresh', bucket: '15min',
    analysisScope: { kind: 'q60', from, activatedAt: from, activationHeight: 144888, historyLimited: false, unclassifiedEvents: 0 },
    registeredTotal: 220, currentValid: 200, currentPoseBanned: 20, currentPosePenalty: 2,
    kpis: { windowWaveCount: 0, windowLargestWave: 0, meanTimeBetweenWavesSec: null },
    timeline: [], waveBands: [], waves: [], trackedNodes: [] };
}
function chainData() {
  const row = (quorumType: number, newBans: number, unknownPenaltyCommitments: number) => ({
    quorumType, newBans, unknownPenaltyCommitments, commitments: 10, verifiedCommitments: 8,
    unavailableCommitments: 2, nullCommitments: 0, participants: 400, invalidMembers: 50, penaltyApplications: 6,
  });
  return { generatedAt: new Date().toISOString(), status: 'ready',
    coverage: { startHeight: 145000, confirmedThroughHeight: 146000, caughtUp: false },
    penaltyCoverage: { enabled: true, verifiedBlocks: 16, commitmentBlocks: 20 },
    quorumSummary: [row(2, 3, 2), row(7, 1, 2)], commitments: [] };
}
test('ban share uses verified bans and shows partial and unknown coverage @smoke', async ({ page }, testInfo) => {
  const ban = banData(); const requests: URL[] = [];
  page.on('request', (request) => { if (request.url().includes(chainPath)) requests.push(new URL(request.url())); });
  await stubApi(page, { [banPath]: { success: true, data: ban }, [chainPath]: { success: true, data: chainData() } });
  await page.goto('/ban-detection');
  const card = page.getByRole('article', { name: 'Ban attribution by quorum type' });
  await expect(card).toContainText('75.0%'); await expect(card).toContainText('Q60: 25.0%');
  await expect(card).toContainText('4 verified ban events');
  await expect(card).toContainText('4 commitments with unknown penalties');
  await expect(card).toContainText('Partial collected range');
  expect(requests[0].searchParams.get('since')).toBe(ban.analysisScope.from);
  expect(requests[0].searchParams.get('fromHeight')).toBe('144888');
  expect(requests[0].searchParams.get('limit')).toBe('1');
  await page.getByRole('tab', { name: '24h', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.has('fromHeight')).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('ban-type-share.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.route(`**${chainPath}*`, (route) => route.fulfill({ status: 503, body: '{}' }));
  await card.getByRole('button', { name: 'Refresh attribution' }).click();
  await expect(card.locator('.mnh-stat-value')).toHaveText('Unknown');
});
for (const scenario of ['disabled', 'collecting', 'zero', 'stale'] as const) {
  test(`${scenario} attribution shows Unknown instead of a percentage @smoke`, async ({ page }) => {
    const data = chainData();
    if (scenario === 'disabled') data.penaltyCoverage.enabled = false;
    if (scenario === 'collecting') data.status = 'collecting';
    if (scenario === 'zero') data.quorumSummary.forEach((row) => { row.newBans = 0; });
    if (scenario === 'stale') data.generatedAt = new Date(Date.now() - 300000).toISOString();
    await stubApi(page, { [banPath]: { success: true, data: banData() }, [chainPath]: { success: true, data } });
    await page.goto('/ban-detection');
    await expect(page.locator('.bd-type-share .mnh-stat-value')).toHaveText('Unknown');
    await expect.poll(() => page.locator('.bd-type-share button').isEnabled()).toBe(true);
    await expect(page.locator('.bd-type-share .mnh-stat-value')).toHaveText('Unknown');
  });
}

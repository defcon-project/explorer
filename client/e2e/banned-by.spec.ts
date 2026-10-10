import { expect, test } from '@playwright/test';
import { stubApi } from './apiStub';
import { resolveBanAttribution } from '../../server/src/domain/pose/banAttribution';
import { attributedBlock, attributionQuery, attributionNow } from '../../server/test/fixtures/banAttribution';

const path = '/api/v1/masternodes/ban-attribution', observationsPath = '/api/v1/network-noise/pose-events';
const id = attributionQuery.proTxHash, height = attributionQuery.banHeight;
const url = `/ban-detection?node=${id}&ban=${height}`;
const panel = (page: import('@playwright/test').Page) => page.getByLabel('Historical ban attribution');
function fixture() {
  const at = new Date().toISOString();
  return { code: 'BANNED_BY', generatedAt: at, proTxHash: id, banHeight: height, collectorStatus: 'ready', attributionEnabled: true,
    coverage: { startHeight: 100, lastHeight: 102, lastHash: 'f'.repeat(64), targetHeight: 103,
      checkedAt: at, lastReorgAt: null, remainingBlocks: 1, caughtUp: false, confirmedThroughHeight: 102 },
    status: 'verified', evidence: 'chain_verified_penalty', reason: null,
    proof: { ...resolveBanAttribution(attributedBlock(true), attributionQuery, attributionNow).proof!, observerCount: 2 },
    message: 'Q400_60 commitment caused this node’s historical ban.', hint: 'Check DKG participation and connectivity logs. The network fault remains unknown.' };
}
function observations() {
  const f = fixture(), p = f.proof;
  return { generatedAt: f.generatedAt, windowHours: 8760, retentionDays: 365, page: 1, limit: 20, total: 1,
    observationCount: 2, uncorrelatedEvents: 0, chainVerifiedEvents: 0,
    events: [{ eventKey: 'e'.repeat(64), kind: 'penalty_change', identityComplete: true,
      evidence: 'log_observed', canonicalStatus: 'unverified', eventBlockHeight: p.blockHeight, eventBlockHash: p.blockHash,
      quorumType: p.quorumType, quorumHash: p.quorumHash, proTxHash: p.proTxHash, firstEventAt: f.generatedAt,
      lastEventAt: f.generatedAt, lastReportedAt: f.generatedAt, observerCount: 2, observerNodeIds: ['seed-one', 'mn-two'],
      observerRoles: ['seed', 'fullnode'], observationCount: 2, hasConflictingScores: true, sample: 'DO NOT RENDER RAW LOG',
      scoreVariants: [{ previousPenalty: 66, penalty: 100, poseBanHeight: 100, memberValid: null },
        { previousPenalty: 66, penalty: 99, poseBanHeight: 100, memberValid: null }] }] };
}

test('selected historical ban drills into scoring, commitment and exact unverified observations @smoke', async ({ page }, testInfo) => {
  const requested: URL[] = [];
  page.on('request', r => { if (r.url().includes(observationsPath)) requested.push(new URL(r.url())); });
  await stubApi(page, { [path]: { success: true, data: fixture() }, [observationsPath]: { success: true, data: observations() } });
  await page.goto(url);
  await expect(panel(page).getByText('BANNED_BY · chain · verified historical ban', { exact: true })).toBeVisible();
  await expect(panel(page)).toContainText('partial collected range');
  expect(requested).toHaveLength(0);
  await panel(page).getByText('2. Penalty · verified scoring', { exact: true }).click();
  await expect(panel(page)).toContainText('before this commitment 66 → after 100');
  await expect(panel(page)).toContainText('applied +34');
  await panel(page).getByText('3. DKG · Q400_60 (type 2)', { exact: true }).click();
  await expect(panel(page).getByRole('link', { name: fixture().proof.txid })).toHaveAttribute('href', `/tx/${fixture().proof.txid}`);
  await panel(page).getByText('4. Observations · 2 distinct reporters · unverified', { exact: true }).click();
  await expect(panel(page)).toContainText('seed-one, mn-two');
  await expect(panel(page)).toContainText('Conflicting reported scores');
  await expect(panel(page)).not.toContainText('DO NOT RENDER RAW LOG');
  const p = fixture().proof;
  expect(Object.fromEntries(requested[0].searchParams)).toMatchObject({ proTxHash: id, eventBlockHeight: String(height),
    eventBlockHash: p.blockHash, quorumType: '2', quorumHash: p.quorumHash, limit: '20', page: '1' });
  await panel(page).screenshot({ path: testInfo.outputPath('banned-by-drilldown.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('row selection creates a shareable ban permalink without querying every node @smoke', async ({ page }) => {
  const f = fixture(), at = f.generatedAt, requests: URL[] = [];
  page.on('request', r => { if (r.url().includes(path)) requests.push(new URL(r.url())); });
  await stubApi(page, { [path]: { success: true, data: f }, '/api/v1/masternodes/ban-waves': { success: true, data: {
    generatedAt: at, rpcAvailable: true, dataStatus: 'fresh', bucket: '15min', registeredTotal: 2,
    currentValid: 1, currentPoseBanned: 1, currentPosePenalty: 0, kpis: { windowWaveCount: 0, windowLargestWave: 0, meanTimeBetweenWavesSec: null },
    timeline: [], waves: [], trackedNodes: [{ nodeId: id, proTxHash: id, service: '198.51.100.42:8192', banCount: 1,
      lastBanAt: at, lastBanHeight: height, recoveredAt: at, currentStatus: 'ENABLED', currentPenalty: 0 }],
  } } });
  await page.goto('/ban-detection'); await expect(page.getByRole('button', { name: 'Ban evidence', exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Ban evidence', exact: true }).click();
  await expect(page).toHaveURL(url);
  await expect(panel(page)).toBeFocused();
  await expect(panel(page)).toContainText('verified historical ban');
  await page.reload(); await expect(panel(page)).toContainText('verified historical ban');
  await page.getByLabel('Find node').fill('198.51.100.42');
  expect(new URL(page.url()).searchParams.has('ban')).toBe(false);
  await expect(panel(page).locator('.ban-proof')).toHaveCount(0);
});

for (const reason of ['collector_disabled', 'unsupported_context', 'read_invalidated']) test(`missing ${reason} evidence stays unknown @smoke`, async ({ page }) => {
  await stubApi(page, { [path]: { success: true, data: { ...fixture(), status: 'unknown', evidence: 'unknown', reason, proof: null } } });
  await page.goto(url); await expect(panel(page).getByRole('status')).toContainText(reason.replace(/_/g, ' '));
  await expect(panel(page).locator('.ban-evidence-badge, .ban-proof')).toHaveCount(0);
});

for (const gap of ['old_response', 'old_collector', 'future_response', 'wrong_identity', 'bad_delta']) test(`rejects ${gap} causal display @smoke`, async ({ page }) => {
  const data = fixture();
  if (gap === 'old_response') data.generatedAt = new Date(Date.now() - 240000).toISOString();
  if (gap === 'old_collector') data.coverage.checkedAt = new Date(Date.now() - 240000).toISOString();
  if (gap === 'future_response') data.generatedAt = new Date(Date.now() + 60000).toISOString();
  if (gap === 'wrong_identity') { data.proTxHash = 'a'.repeat(64); data.proof.proTxHash = data.proTxHash; }
  if (gap === 'bad_delta') data.proof.penalty.appliedDelta += 1;
  await stubApi(page, { [path]: { success: true, data } }); await page.goto(url);
  await expect(panel(page).getByRole('status')).toContainText('Unknown');
  await expect(panel(page).locator('.ban-evidence-badge, .ban-proof')).toHaveCount(0);
});

test('paused cached evidence expires without a network refresh @smoke', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await stubApi(page, { [path]: { success: true, data: fixture() } });
  await page.goto(url); await expect(panel(page).locator('.ban-proof')).toBeVisible();
  await page.getByRole('button', { name: 'Pause auto-refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume auto-refresh', exact: true })).toBeVisible();
  await page.clock.fastForward(195000);
  await expect(panel(page).getByRole('status')).toContainText('Unknown');
  await expect(panel(page).locator('.ban-evidence-badge, .ban-proof')).toHaveCount(0);
});

test('observation pagination is manual and preserves exact anchors @smoke', async ({ page }) => {
  const requested: URL[] = [];
  await stubApi(page, { [path]: { success: true, data: fixture() } });
  await page.route(`**${observationsPath}*`, r => {
    const request = new URL(r.request().url()); requested.push(request);
    const data = observations(); data.page = Number(request.searchParams.get('page')); data.total = 21;
    data.events[0].observerNodeIds = data.page === 1 ? ['seed-one', 'mn-two'] : ['next-page'];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  await page.goto(url); await panel(page).getByText('4. Observations · 2 distinct reporters · unverified', { exact: true }).click();
  await expect(panel(page)).toContainText('seed-one'); expect(requested).toHaveLength(1);
  await panel(page).getByRole('button', { name: 'Next observations' }).click();
  await expect(panel(page)).toContainText('next-page'); await expect(panel(page)).not.toContainText('seed-one');
  expect(requested[1].searchParams.get('page')).toBe('2');
  expect(requested[1].searchParams.get('eventBlockHash')).toBe(fixture().proof.blockHash);
  await expect(panel(page).getByRole('button', { name: 'Next observations' })).toBeDisabled();
});

test('failed refresh retracts an existing cause and wrong observation anchors never appear @smoke', async ({ page }) => {
  const logs = observations(); logs.events[0].eventBlockHash = 'a'.repeat(64);
  await stubApi(page, { [path]: { success: true, data: fixture() }, [observationsPath]: { success: true, data: logs } });
  await page.goto(url); await expect(panel(page).locator('.ban-proof')).toBeVisible();
  await panel(page).getByText('4. Observations · 2 distinct reporters · unverified', { exact: true }).click();
  await expect(panel(page).getByRole('status')).toContainText('Observations unavailable');
  await expect(panel(page)).not.toContainText('seed-one');
  await page.route(`**${path}*`, r => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await panel(page).getByRole('button', { name: 'Refresh ban evidence' }).click();
  await expect(panel(page).getByRole('status')).toContainText('Unknown');
  await expect(panel(page).locator('.ban-evidence-badge, .ban-proof')).toHaveCount(0);
});

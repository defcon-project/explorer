import { expect, test } from '@playwright/test';
import { stubApi } from './apiStub';
const path = '/api/v1/masternodes/operator-diagnosis', id = 'a'.repeat(64);
function fixture() {
  const at = new Date().toISOString();
  return { generatedAt: at, registeredCount: 220, maxPenalty: 220, historySince: at, historyLimited: true,
    nodes: [{ proTxHash: id, service: '198.51.100.42:8192', operatorDiagnosis: [{ code: 'BAN_NEXT_DKG',
      level: 'action', evidence: 'chain', since: at, source: 'protx list registered', operatorAction: true,
      message: 'Another invalid DKG can reach the threshold.', hint: 'Check connectivity. Conditional estimate.' }] },
    { proTxHash: 'b'.repeat(64), service: '198.51.100.43:8192', operatorDiagnosis: [{ code: 'REVIVE_LOOP',
      level: 'action', evidence: 'pattern', since: at, source: 'MasternodeEvent', operatorAction: false,
      message: 'Three recorded revival cycles.', hint: 'Pause automated revival and investigate.' }] }] };
}
test('permalink, action evidence, touch details and operator notice @smoke', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await stubApi(page, { [path]: { success: true, data: fixture() } });
  await page.goto(`/ban-detection?node=${id}`);
  await expect(page.getByLabel('Find node')).toHaveValue(id);
  await expect(page.locator('.operator-action-row')).toHaveCount(1);
  await page.locator('.operator-diagnosis summary').filter({ hasText: 'BAN_NEXT_DKG' }).click();
  await expect(page.getByText('Check connectivity. Conditional estimate.')).toBeVisible();
  await expect(page.locator('.operator-panel a')).toHaveAttribute('href', `/ban-detection?node=${id}`);
  await page.getByRole('button', { name: 'Operator notice', exact: true }).click();
  await expect(page.locator('.operator-panel').getByRole('status')).toContainText('Operator notice copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('**BAN_NEXT_DKG**');
  await page.getByLabel('Find node').fill('198.51.100.43');
  await expect(page.locator('.operator-panel tbody tr')).toHaveCount(1);
  await expect(page.locator('.operator-action-row')).toHaveCount(0);
  await page.locator('.operator-diagnosis summary').filter({ hasText: 'REVIVE_LOOP' }).click();
  await expect(page.getByText('Pause automated revival and investigate.')).toBeVisible();
  await page.locator('.operator-panel').screenshot({ path: testInfo.outputPath('operator-panel.png') });
  expect(new URL(page.url()).searchParams.get('node')).toBe('198.51.100.43');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('failed diagnosis refresh removes action cues and disables notice @smoke', async ({ page }) => {
  await stubApi(page, { [path]: { success: true, data: fixture() } });
  await page.goto('/ban-detection'); await expect(page.locator('.operator-action-row')).toHaveCount(1);
  await page.route(`**${path}*`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.getByRole('button', { name: 'Refresh diagnosis' }).click();
  await expect(page.locator('.operator-action-row')).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Operator notice', exact: true })).toBeDisabled();
});
test('expired diagnosis snapshot never displays operator action @smoke', async ({ page }) => {
  const data = fixture(); data.generatedAt = new Date(Date.now() - 240000).toISOString();
  await stubApi(page, { [path]: { success: true, data } }); await page.goto('/ban-detection');
  await expect(page.getByText('Operator diagnosis unavailable or awaiting a fresh snapshot.')).toBeVisible();
  await expect(page.locator('.operator-action-row')).toHaveCount(0);
});

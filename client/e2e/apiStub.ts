import type { Page } from '@playwright/test';

type ApiResponse = Record<string, unknown>;

export async function stubApi(page: Page, responses: Record<string, ApiResponse> = {}) {
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const response = responses[pathname];

    if (response) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    }

    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Browser smoke test API stub' }),
    });
  });
}

import { defineConfig, devices } from '@playwright/test';

const previewUrl = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: previewUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
    url: previewUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

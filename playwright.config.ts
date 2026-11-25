import { defineConfig, devices } from '@playwright/test';

const PORT = 4330;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `GHCC_SKIP_BOOT_CHECK=1 PORT=${PORT} npm run build && GHCC_SKIP_BOOT_CHECK=1 PORT=${PORT} node scripts/start.mjs`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});

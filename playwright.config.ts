import { defineConfig } from '@playwright/test';

const port = Number(process.env.SOARING_TEST_PORT ?? 4173);
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.smoke\.ts/,
  use: { baseURL: url, channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url, reuseExistingServer: !process.env.SOARING_TEST_PORT },
});

import { defineConfig } from '@playwright/test';

const port = process.env.SOARING_TEST_PORT ?? '4173';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.smoke\.ts/,
  use: { baseURL: `http://127.0.0.1:${port}`, channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});

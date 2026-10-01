import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.smoke\.ts/,
  reporter: [['list'], ['json', { outputFile: 'test-results/smoke-timings.json' }]],
  use: { baseURL: 'http://127.0.0.1:4197', channel: 'chrome', viewport: { width: 1440, height: 900 }, trace: 'on', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --port 4197 --strictPort', url: 'http://127.0.0.1:4197', reuseExistingServer: false },
});

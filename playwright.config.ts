import { defineConfig } from '@playwright/test';

const port = Number(process.env.SMOKE_PORT ?? 4197);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.smoke\.ts/,
  // In CI, shards balance single tests instead of whole files. Serial describes stay together.
  fullyParallel: !!process.env.CI,
  reporter: [['list'], ['json', { outputFile: 'test-results/smoke-timings.json' }]],
  use: { baseURL: origin, channel: 'chrome', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: origin, reuseExistingServer: false },
});

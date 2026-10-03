import { defineConfig } from '@playwright/test';

const port = Number(process.env.PRODUCTION_SMOKE_PORT ?? 41983);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: /bundle\.production\.ts/,
  reporter: [['list'], ['json', { outputFile: 'test-results/production-smoke-timings.json' }]],
  use: { baseURL: `${origin}/soaring/`, channel: 'chrome', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `${origin}/soaring/`, reuseExistingServer: false },
});

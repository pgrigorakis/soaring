import { defineConfig } from '@playwright/test';

// `npm run bench`: the held-vantage perf bench. Kept apart from the smoke config so it never runs in CI.
// With BENCH_BUILDS set, the dev servers for those builds are already running, so none is started here.
const port = Number(process.env.SMOKE_PORT ?? 4198);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.bench\.ts/,
  reporter: [['list']],
  timeout: 3_600_000,
  use: { baseURL: origin, channel: 'chrome' },
  webServer: process.env.BENCH_BUILDS ? undefined
    : { command: `npm run dev -- --port ${port} --strictPort`, url: origin, reuseExistingServer: false },
});

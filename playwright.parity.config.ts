import { defineConfig } from '@playwright/test';

const port = Number(process.env.PARITY_PORT ?? 4198);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: /look-parity\.bench\.ts/,
  reporter: [['list']],
  timeout: 3_600_000,
  use: { baseURL: origin, channel: 'chrome' },
  webServer: process.env.PARITY_URL ? undefined
    : { command: `npm run dev -- --port ${port} --strictPort`, url: origin, reuseExistingServer: false },
});

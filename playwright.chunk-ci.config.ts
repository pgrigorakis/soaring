import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Local reproduction of CI's one-worker software-WebGL browser. Product budgets stay unchanged.
export default defineConfig({
  ...base,
  workers: 1,
  webServer: { command: 'npm run dev -- --port 4186 --strictPort', url: 'http://127.0.0.1:4186', reuseExistingServer: false },
  use: {
    ...base.use,
    baseURL: 'http://127.0.0.1:4186',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});

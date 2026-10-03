import { defineConfig } from '@playwright/test';
import base from './playwright.production.config';

export default defineConfig({
  ...base,
  workers: 1,
  use: {
    ...base.use,
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});

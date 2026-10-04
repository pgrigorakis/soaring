import { defineConfig } from 'vite';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/soaring/' : '/',
  server: { host: '127.0.0.1', port: 4173 },
  preview: { host: '127.0.0.1', port: 4173 },
  // The default 5 s limit fails one-hour navigation tests on a loaded CI runner.
  test: { testTimeout: 30_000 },
}));

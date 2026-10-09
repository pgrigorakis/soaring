import { expect, test } from '@playwright/test';

test('production bundle serves from its base path and renders without dev hooks or page errors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '0');
    const probe = { colors: 0, draws: 0, buffer: [0, 0], region: [0, 0, 0], renderer: '' };
    Object.assign(window, { __productionPixelProbe: probe });
    const pixels = new Uint8Array(256 * 256 * 4);
    const sample = (gl: WebGL2RenderingContext) => {
      if (probe.colors > 8 || gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null
        || gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) !== null) return;
      probe.draws += 1;
      const size = Math.min(256, gl.drawingBufferWidth, gl.drawingBufferHeight);
      const x = Math.floor((gl.drawingBufferWidth - size) / 2);
      const y = Math.max(0, Math.floor(gl.drawingBufferHeight * 0.45 - size / 2));
      // Read inside the visible draw, before the browser discards its default framebuffer.
      // The foreground remains visible while unfinished terrain is intentionally masked by haze.
      gl.readPixels(x, y, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const colors = new Set<number>();
      for (let index = 0; index < size * size * 4; index += 4) {
        colors.add((pixels[index]! << 16) | (pixels[index + 1]! << 8) | pixels[index + 2]!);
        if (colors.size > 8) break;
      }
      probe.colors = Math.max(probe.colors, colors.size);
      probe.buffer = [gl.drawingBufferWidth, gl.drawingBufferHeight];
      probe.region = [x, y, size];
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      if (debug) probe.renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
    };
    const prototype = WebGL2RenderingContext.prototype as unknown as Record<string, (this: WebGL2RenderingContext, ...args: unknown[]) => void>;
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = prototype[name]!;
      prototype[name] = function (...args) {
        original.apply(this, args);
        sample(this);
      };
    }
  });

  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.waitForFunction(() => (window.__productionPixelProbe?.colors ?? 0) > 8);
  const pixels = await page.evaluate(() => window.__productionPixelProbe);
  expect(pixels?.colors).toBeGreaterThan(8);
  expect(pixels?.draws).toBeGreaterThan(0);
  await testInfo.attach('production-visible-pixels', { body: JSON.stringify(pixels), contentType: 'application/json' });
  const productionState = await page.evaluate(() => ({
    basePath: new URL(document.querySelector('script[type="module"]')?.getAttribute('src') ?? '', location.href).pathname,
    seed: localStorage.getItem('soaring.world-seed.v1'),
    hasDevelopmentHooks: '__SOARING__' in window,
    diagnosticsVisible: document.querySelector('#diagnostics')?.classList.contains('visible') ?? false,
  }));
  expect(productionState.basePath).toContain('/soaring/');
  expect(productionState.seed).toBe('0');
  expect(productionState.hasDevelopmentHooks).toBe(false);
  expect(productionState.diagnosticsVisible).toBe(false);
  await page.locator('.start-screen').click();
  await expect(page.locator('.start-screen')).toHaveCount(0, { timeout: 15_000 });
  const hud = page.getByRole('region', { name: 'Height above sea level and bearing' });
  await expect(hud).toBeVisible();
  await expect(hud.getByLabel('Height above sea level', { exact: true })).toHaveText(/^\d+ m$/);
  await expect(hud.getByLabel('Eagle bearing')).toHaveText(/^\d{3}°$/);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('production-bundle.png') });
});

declare global {
  interface Window {
    __productionPixelProbe?: { colors: number; draws: number; buffer: number[]; region: number[]; renderer: string };
  }
}

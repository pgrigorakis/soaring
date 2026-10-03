import { expect, test } from '@playwright/test';

test('production bundle serves from its base path and renders without dev hooks or page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '0');
    localStorage.setItem('soaring.settings.v1', JSON.stringify({ terrainVisibility: 720 }));
  });

  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) return false;
    const pixels = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) {
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    }
    return colors.size > 8;
  });
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
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/production-bundle.png' });
});

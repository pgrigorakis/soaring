import { expect, test, type Page } from '@playwright/test';

function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Boot with a supported quality preset via the app's real settings key. */
async function seedQuality(page: Page, quality: 'low' | 'medium' | 'high'): Promise<void> {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('soaring.settings.v1')) {
      localStorage.setItem('soaring.settings.v1', JSON.stringify({
        volume: 0.52,
        muted: true,
        quality: value,
        cameraDistance: 178,
      }));
    }
  }, quality);
}

test('renders, streams, and supports camera controls', async ({ page }) => {
  const errors = captureErrors(page);
  // CI runners use software WebGL; low is the supported preset that keeps the
  // main thread free enough for streaming + camera-drag within the test budget.
  await seedQuality(page, 'low');
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.locator('#diagnostics')).toBeVisible();
  await page.evaluate(() => window.__SOARING__.setTimeScale(8));
  await page.waitForFunction(() => window.__SOARING__?.snapshot().chunks > 8);
  const before = await page.evaluate(() => window.__SOARING__.snapshot());
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(Math.hypot(after.position[0]! - before.position[0]!, after.position[2]! - before.position[2]!)).toBeGreaterThan(8);
  expect(after.chunks).toBeLessThanOrEqual(40);
  expect(after.geometries).toBeLessThan(120);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no layout box');
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.42, { steps: 6 });
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('tracks the active thermal and persists the visibility setting', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = captureErrors(page);
  await seedQuality(page, 'low');
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  const setting = page.getByRole('checkbox', { name: 'Show thermal' });
  await page.locator('#settings-toggle').click();
  await expect(setting).toBeChecked();
  await page.evaluate(() => window.__SOARING__.setTimeScale(12));
  await page.waitForFunction(() => window.__SOARING__.snapshot().activeThermal !== null, undefined, { timeout: 25_000 });
  const active = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(active.marker).toEqual(active.activeThermal);
  await setting.uncheck();
  expect((await page.evaluate(() => window.__SOARING__.snapshot())).marker).toBeNull();
  await page.reload();
  await page.locator('#settings-toggle').click();
  await expect(setting).not.toBeChecked();
  await page.evaluate(() => window.__SOARING__.setTimeScale(12));
  await page.waitForFunction(() => window.__SOARING__.snapshot().activeThermal !== null, undefined, { timeout: 25_000 });
  expect((await page.evaluate(() => window.__SOARING__.snapshot())).marker).toBeNull();
  await setting.check();
  const enabled = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(enabled.marker).toEqual(enabled.activeThermal);
  expect(errors).toEqual([]);
});

test('persists safe local-terrain height bounds across reloads', async ({ page }) => {
  const errors = captureErrors(page);
  await seedQuality(page, 'low');
  await page.goto('/');
  await page.locator('#settings-toggle').click();
  await page.locator('#min-height').evaluate((input: HTMLInputElement) => {
    input.value = '90';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#max-height').evaluate((input: HTMLInputElement) => {
    input.value = '145';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#min-height-value')).toHaveText('90 m');
  await expect(page.locator('#max-height-value')).toHaveText('145 m');
  await page.reload();
  await expect(page.locator('#min-height')).toHaveValue('90');
  await expect(page.locator('#max-height')).toHaveValue('145');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('soaring.settings.v1') ?? '{}'));
  expect([saved.minFlightHeight, saved.maxFlightHeight]).toEqual([90, 145]);
  expect(errors).toEqual([]);
});

test('keeps settings usable after ambient controls fade', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no layout box');
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);

  const controls = page.locator('#controls');
  await expect(controls).toHaveClass(/visible/);
  await expect(controls).not.toHaveClass(/visible/, { timeout: 5000 });
  const settingsToggle = page.locator('#settings-toggle');
  await expect(settingsToggle).toBeVisible();
  await settingsToggle.click();
  await expect(controls).toHaveClass(/visible/);
  await expect(page.locator('#settings-panel')).toBeVisible();
  await expect(settingsToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(settingsToggle).toHaveAccessibleName('Close settings');
  await page.locator('#quality').selectOption('low');
  await expect(page.locator('#quality')).toHaveValue('low');
  expect(errors).toEqual([]);
});
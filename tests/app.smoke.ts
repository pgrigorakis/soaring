import { expect, test, type Page } from '@playwright/test';

function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('renders high-detail terrain, streams, and supports camera controls', async ({ page }) => {
  const errors = captureErrors(page);
  // Development-only smoke mode reduces software-WebGL pixel work and disables shadows.
  await page.goto('/?smoke');
  await expect(page.locator('canvas')).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.locator('#diagnostics')).toBeVisible();
  await page.evaluate(() => window.__SOARING__.setTimeScale(8));
  await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0);
  const before = await page.evaluate(() => window.__SOARING__.snapshot());
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(Math.hypot(after.position[0]! - before.position[0]!, after.position[2]! - before.position[2]!)).toBeGreaterThan(8);
  expect(after.chunks).toBeLessThanOrEqual(49);
  expect(after.visibleDistance).toBe(720);
  expect(after.geometries).toBeLessThan(200);
  expect(after.requestedDistance).toBe(720);

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
  await page.goto('/?smoke');
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

test('visibility and camera distance persist independently; old settings migrate', async ({ page }) => {
  const errors = captureErrors(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('soaring.settings.v1')) localStorage.setItem('soaring.settings.v1', JSON.stringify({
      volume: 0.4, muted: false, quality: 'high', cameraDistance: 220,
    }));
  });
  await page.goto('/?smoke');
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
  await expect(page.locator('#quality')).toHaveCount(0);
  await expect(page.locator('#distance')).toHaveValue('220');
  await expect(page.locator('#volume')).toHaveValue('0.4');
  await expect(page.locator('#visibility')).toHaveValue('1080');
  await page.locator('#visibility').fill('3600');
  await expect(page.locator('#distance')).toHaveValue('220');
  await page.locator('#distance').fill('160');
  await page.reload();
  await expect(page.locator('#visibility')).toHaveValue('3600');
  await expect(page.locator('#distance')).toHaveValue('160');
  // Full far-field loading is covered by unit tests; here the stream only has to make bounded progress.
  const first = await page.evaluate(() => window.__SOARING__.snapshot());
  await page.waitForFunction((chunks) => window.__SOARING__.snapshot().chunks >= chunks + 20, first.chunks);
  const snapshot = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(snapshot.requestedDistance).toBe(3600);
  expect(snapshot.cameraDistance).toBe(160);
  expect(snapshot.visibleDistance).toBeLessThanOrEqual(3600);
  expect(snapshot.chunks + snapshot.pending).toBeLessThan(700);
  expect(errors).toEqual([]);
});

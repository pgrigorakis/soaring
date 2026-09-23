import { expect, test, type Page } from '@playwright/test';

function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Boot with a supported quality preset via the app's real settings key. */
async function seedQuality(page: Page, quality: 'low' | 'medium' | 'high', volume = 0.52): Promise<void> {
  await page.addInitScript(({ quality, volume }) => {
    if (!localStorage.getItem('soaring.settings.v1')) localStorage.setItem('soaring.settings.v1', JSON.stringify({
      volume,
      muted: true,
      quality,
      cameraDistance: 178,
    }));
  }, { quality, volume });
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

test('migrates prior volume, saves independent controls, and preserves mute on reload', async ({ page }) => {
  const errors = captureErrors(page);
  await seedQuality(page, 'low', 0.37);
  await page.goto('/');
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#ambience')).toHaveValue('0.37');
  await expect(page.locator('#music')).toHaveValue('0.37');
  await page.locator('#ambience').fill('0.2');
  await page.locator('#music').fill('0.8');
  await expect(page.locator('#ambience-value')).toHaveText('20%');
  await expect(page.locator('#music-value')).toHaveText('80%');
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('On');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('soaring.settings.v1')!));
  expect(settings).toMatchObject({ ambienceVolume: 0.2, musicVolume: 0.8, muted: false });
  await page.reload();
  await expect(page.locator('#mute')).toHaveText('Muted');
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#ambience')).toHaveValue('0.2');
  await expect(page.locator('#music')).toHaveValue('0.8');
  await expect(page.locator('#mute')).toHaveText('On');
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('Muted');
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soaring.settings.v1')!).muted)).toBe(true);
  expect(errors).toEqual([]);
});

test('a blocked browser audio context keeps the mute control usable without page errors', async ({ page }) => {
  const errors = captureErrors(page);
  await seedQuality(page, 'low');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { value: class { constructor() { throw new Error('Audio unavailable'); } } });
  });
  await page.goto('/');
  await page.locator('#settings-toggle').click();
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('Muted');
  await expect(page.locator('.audio-note')).toContainText('Audio could not start');
  expect(errors).toEqual([]);
});

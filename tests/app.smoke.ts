import { expect, test } from '@playwright/test';

test('renders, streams, and exposes usable controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?diagnostics=1&speed=8');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#diagnostics')).toBeVisible();
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

  await page.locator('#settings-toggle').click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  await page.locator('#quality').selectOption('low');
  await expect(page.locator('#quality')).toHaveValue('low');
  expect(errors).toEqual([]);
});

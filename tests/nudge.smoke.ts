import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Arrow keys nudge the autopilot: a held turn bends the course, a release adopts it for three
// minutes, and a small hint names the action. Simulated time keeps the comparison repeatable.
const SEED = '448122';
const degrees = (radians: number) => radians * 180 / Math.PI;
const wrap = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians));

async function start(page: Page): Promise<void> {
  await page.addInitScript((seed) => {
    localStorage.setItem('soaring.world-seed.v1', seed);
    localStorage.setItem('soaring.scenic-visit.v1', '0');
  }, SEED);
  await page.goto('/?smoke');
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.evaluate(() => window.__SOARING__.advanceSimulation!(30));
}

const snapshot = (page: Page) => page.evaluate(() => window.__SOARING__.snapshot());
const advance = (page: Page, seconds: number) => page.evaluate((s) => window.__SOARING__.advanceSimulation!(s), seconds);
const hint = (page: Page) => page.locator('#nudge-hint');

test('a held arrow bends the course, the hint names it, and release adopts the new heading', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await start(page);
  await advance(page, 4);
  const baseline = await snapshot(page);

  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible();
  await advance(page, 30);
  await expect(hint(page)).not.toHaveClass(/visible/);
  await page.keyboard.down('ArrowLeft');
  await advance(page, 4);
  const held = await snapshot(page);
  await expect(hint(page)).toHaveClass(/visible/);
  await expect(hint(page).locator('.nudge-text')).toHaveText('bearing left');
  await expect(hint(page).locator('[data-key="left"]')).toHaveClass(/held/);
  await mkdir('test-results/nudge', { recursive: true });
  await page.screenshot({ path: 'test-results/nudge/held-left.png' });
  await page.keyboard.up('ArrowLeft');
  await advance(page, 1);
  const released = await snapshot(page);
  await expect(hint(page).locator('.nudge-text')).toHaveText(/^holding your course · 2:5\d$/);
  await page.screenshot({ path: 'test-results/nudge/holding-course.png' });
  await advance(page, 20);
  const later = await snapshot(page);

  const evidence = {
    seed: Number(SEED),
    turnAt4s: degrees(wrap(held.heading - baseline.heading)),
    driftFromAdopted: degrees(wrap(later.heading - released.heading)),
    held: held.nudge, released: released.nudge, later: later.nudge,
  };
  await writeFile('test-results/nudge/evidence.json', JSON.stringify(evidence, null, 2));
  // Increasing heading turns right, so a left nudge makes the heading smaller than the free flight's.
  expect(held.nudge.turn).toBe(-1);
  expect(evidence.turnAt4s).toBeLessThan(-60);
  expect(released.nudge.adopted).toBeGreaterThan(170);
  expect(later.nudge.adopted).toBeGreaterThan(150);
  // The free flight turns toward the sunrise; the adopted course holds the released heading instead.
  expect(Math.abs(evidence.driftFromAdopted)).toBeLessThan(30);
  expect(errors).toEqual([]);
});

test('arrow keys stay with a focused slider, and up or down names the climb', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page);

  // Reveal the settings, as a viewer would, so the slider can take focus.
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await page.locator('#settings-toggle').click();
  const slider = page.locator('#settings-panel input[type="range"]').first();
  await expect(slider).toBeVisible();
  await slider.focus();
  await expect(slider).toBeFocused();
  const before = await slider.inputValue();
  await page.keyboard.down('ArrowLeft');
  await advance(page, 1);
  expect((await snapshot(page)).nudge.turn).toBe(0);
  await page.keyboard.up('ArrowLeft');
  expect(await slider.inputValue()).not.toBe(before);
  await expect(hint(page)).not.toHaveClass(/visible/);

  await slider.blur();
  await page.keyboard.down('ArrowUp');
  await advance(page, 0.5);
  expect((await snapshot(page)).nudge.climb).toBe(1);
  await expect(hint(page).locator('.nudge-text')).toHaveText('climbing');
  await page.keyboard.up('ArrowUp');
  await page.keyboard.down('ArrowDown');
  await advance(page, 0.5);
  expect((await snapshot(page)).nudge.climb).toBe(-1);
  await expect(hint(page).locator('.nudge-text')).toHaveText('diving');
  await page.keyboard.up('ArrowDown');
  // A blurred window must not leave a key held.
  await page.keyboard.down('ArrowRight');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await advance(page, 0.5);
  expect((await snapshot(page)).nudge.turn).toBe(0);
  expect(errors).toEqual([]);
});

import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// The white start screen holds until a click, then fades only after the first world frame's GPU work is done
// and one more browser frame has passed. Evidence goes to test-results/start-screen/.
const OUT = process.env.START_SCREEN_OUT ?? 'test-results/start-screen';

test('start screen waits for a click, then fades into a drawn world', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '448122');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
    // Count GPU fences and record the frame count when the fade starts.
    const w = window as unknown as { __fade: { renderedFrames: number; fences: number; at: number; nearReady: boolean } | null; __fences: number };
    w.__fade = null;
    w.__fences = 0;
    const fenceSync = WebGL2RenderingContext.prototype.fenceSync;
    WebGL2RenderingContext.prototype.fenceSync = function (...args) { w.__fences += 1; return fenceSync.apply(this, args); };
    new MutationObserver(() => {
      const screen = document.querySelector('#start-screen');
      if (screen?.classList.contains('fading') && !w.__fade) {
        w.__fade = { renderedFrames: window.__SOARING__.snapshot().renderedFrames, fences: w.__fences, at: performance.now(), nearReady: window.__SOARING__.snapshot().startupNearReady };
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  await page.goto('/?smoke&start');
  const screen = page.locator('#start-screen');
  await expect(screen).toBeVisible();
  await expect(screen.locator('.start-title')).toHaveText('Soaring');
  await expect(screen.locator('.start-prompt')).toHaveText('Click anywhere to start');

  // The world draws behind the screen, but the screen holds without a click.
  await page.waitForFunction(() => window.__SOARING__.snapshot().renderedFrames >= 3);
  await page.waitForTimeout(1500);
  expect(await screen.evaluate((el) => el.classList.contains('fading'))).toBe(false);
  expect(await screen.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await page.screenshot({ path: `${OUT}/1-start-screen.png` });

  const clickedAt = await page.evaluate(() => performance.now());
  await page.mouse.click(300, 200);
  await page.waitForFunction(() => (window as unknown as { __fade: unknown }).__fade !== null);
  const fade = await page.evaluate(() => (window as unknown as { __fade: { renderedFrames: number; fences: number; at: number; nearReady: boolean } }).__fade);
  expect(fade.renderedFrames).toBeGreaterThanOrEqual(1);
  expect(fade.fences).toBeGreaterThanOrEqual(1);
  // Real terrain must finish near ground, water and trees before the normal reveal.
  expect(fade.nearReady).toBe(true);
  expect(fade.at - clickedAt).toBeLessThan(10_000);

  await page.screenshot({ path: `${OUT}/2-fade-start.png` });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/3-fade-middle.png` });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/4-fade-late.png` });
  await expect(screen).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/5-world.png` });
  await writeFile(`${OUT}/evidence.json`, JSON.stringify({ fade, clickedAt, clickToRemovalMs: await page.evaluate(() => performance.now()) - clickedAt }, null, 2));
});

// Failure modes: readiness never arrives, the bird moves away from the preload, or the cap bypasses the GPU barrier.
test('slow terrain caps the white-screen wait without moving the starting view', async ({ page }) => {
  // Suppress only the ready signal. The real streamer, scene and GPU still run.
  await page.route('**/src/terrain.ts', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const method = 'startupReady(x, z, radius) {';
    expect(body).toContain(method);
    await route.fulfill({ response, body: body.replace(method, `${method} return false;`) });
  });
  await page.goto('/?smoke&start');
  const screen = page.locator('#start-screen');
  await expect(screen).toBeVisible();
  const initial = await page.evaluate(() => window.__SOARING__.snapshot().position);
  const clickedAt = await page.evaluate(() => {
    const screen = document.querySelector<HTMLButtonElement>('#start-screen')!;
    const w = window as unknown as { __capFadeAt: number | null };
    w.__capFadeAt = null;
    new MutationObserver(() => {
      if (screen.classList.contains('fading') && w.__capFadeAt === null) w.__capFadeAt = performance.now();
    }).observe(screen, { attributes: true, attributeFilter: ['class'] });
    const at = performance.now();
    screen.click();
    return at;
  });
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__SOARING__.snapshot().position)).toEqual(initial);
  expect(await screen.evaluate((el) => el.classList.contains('fading'))).toBe(false);
  await page.waitForFunction(() => document.querySelector('#start-screen')?.classList.contains('fading'));
  const fadeAt = await page.evaluate(() => (window as unknown as { __capFadeAt: number }).__capFadeAt);
  expect(fadeAt - clickedAt).toBeGreaterThanOrEqual(8000);
  expect(fadeAt - clickedAt).toBeLessThan(10_000);
  expect(await page.evaluate(() => window.__SOARING__.snapshot().renderedFrames)).toBeGreaterThan(1);
  await expect(screen).toHaveCount(0);
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/cap-world.png` });
  await writeFile(`${OUT}/cap-evidence.json`, JSON.stringify({ clickedAt, fadeAt, initial }, null, 2));
});

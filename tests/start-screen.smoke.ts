import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// The white start screen holds until a click, then fades only after the first world frame's GPU work is done
// and one more browser frame has passed. Evidence goes to test-results/start-screen/.
const OUT = 'test-results/start-screen';

test('start screen waits for a click, then fades into a drawn world', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '448122');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
    // Count GPU fences and record the frame count when the fade starts.
    const w = window as unknown as { __fade: { renderedFrames: number; fences: number; at: number } | null; __fences: number };
    w.__fade = null;
    w.__fences = 0;
    const fenceSync = WebGL2RenderingContext.prototype.fenceSync;
    WebGL2RenderingContext.prototype.fenceSync = function (...args) { w.__fences += 1; return fenceSync.apply(this, args); };
    new MutationObserver(() => {
      const screen = document.querySelector('#start-screen');
      if (screen?.classList.contains('fading') && !w.__fade) {
        w.__fade = { renderedFrames: window.__SOARING__.snapshot().renderedFrames, fences: w.__fences, at: performance.now() };
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

  await page.mouse.click(300, 200);
  await page.waitForFunction(() => (window as unknown as { __fade: unknown }).__fade !== null);
  const fade = await page.evaluate(() => (window as unknown as { __fade: { renderedFrames: number; fences: number } }).__fade);
  expect(fade.renderedFrames).toBeGreaterThanOrEqual(1);
  expect(fade.fences).toBeGreaterThanOrEqual(1);

  await page.screenshot({ path: `${OUT}/2-fade-start.png` });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/3-fade-middle.png` });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/4-fade-late.png` });
  await expect(screen).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/5-world.png` });
  await writeFile(`${OUT}/evidence.json`, JSON.stringify({ fade }, null, 2));
});

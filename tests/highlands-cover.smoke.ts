import { expect, test } from '@playwright/test';

// The real default chase camera must see white peak cover in both light states.
// Do not substitute an elevated or orbit camera for the acceptance captures.
test('Highlands snow caps remain visible from the default chase camera', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '57');
  });
  await page.goto('/?smoke');
  await page.evaluate(() => {
    window.__SOARING__.reviewFlight!({ x: 113000, z: 73100, heading: Math.PI / 4 });
    window.__SOARING__.setVisibility(1800);
    document.querySelector('#intro')?.classList.add('hidden');
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
  });
  await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0);
  const cover = await page.evaluate(async () => {
    const terrainPath = '/src/terrain.ts';
    const worldPath = '/src/world.ts';
    const { snowCover } = await import(/* @vite-ignore */ terrainPath) as typeof import('../src/terrain');
    const { WorldModel } = await import(/* @vite-ignore */ worldPath) as typeof import('../src/world');
    const world = new WorldModel(57);
    // FWM's continental mask moves mountains. Elevated drainage cirques are gone.
    const peak = world.sample(113400, 73500);
    return { height: peak.height, cap: snowCover(peak, 0.2, 113400, 73500, 57),
      cliff: snowCover(peak, 1, 113400, 73500, 57),
      below: snowCover({ ...peak, temperature: 0.5 }, 0.2, 113400, 73500, 57) };
  });
  expect(cover.height).toBeGreaterThan(800);
  expect(cover.cap).toBe(1);
  expect(cover.cliff).toBe(0);
  expect(cover.below).toBe(0);
  for (const [phase, label] of [[0.5, 'noon'], [0.72, 'golden-hour']] as const) {
    const frame = await page.evaluate((phase) => {
      window.__SOARING__.setTimeOfDay(phase);
      return window.__SOARING__.snapshot().renderedFrames;
    }, phase);
    await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame, frame);
    await testInfo.attach(`highlands-${label}`, { body: await page.screenshot({ path: `test-results/highlands-${label}.png` }), contentType: 'image/png' });
  }
});

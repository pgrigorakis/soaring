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
    window.__SOARING__.reviewFlight!({ x: 17250, z: 32250, heading: 0 });
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
    // #93's climate cooling leaves warm peaks bare. This taller nearby peak remains snowy.
    const peak = world.sample(17250, 33000);
    const cirque = world.reachesIn(13500, 28000, 20000, 35500).find((reach) => reach.lake
      && world.drainageAt(Math.floor(reach.ax / 500), Math.floor(reach.az / 500)).downstreamI !== null);
    return { cirque: cirque ? { water: world.sample(cirque.ax, cirque.az).water, radius: cirque.aWidth / 2 } : null,
      height: peak.height, cap: snowCover(peak, 0.2, 17250, 33000, 57),
      cliff: snowCover(peak, 1, 17250, 33000, 57),
      below: snowCover({ ...peak, temperature: 0.5 }, 0.2, 17250, 33000, 57) };
  });
  expect(cover.cirque?.water).toBe(true);
  expect(cover.cirque?.radius).toBeLessThanOrEqual(200);
  expect(cover.height).toBeGreaterThan(420);
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

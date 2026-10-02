import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Failure modes: collision-floor corrections mask late climbs; thermal ceilings cause
// vertical jumps; a higher ground reference causes excessive flapping; lattice
// interpolation erases snow-height crests; snow leaks onto steep rock or water.
// Keep #57's original clearance/energy ceilings. #58 relocates the Highlands fixture,
// not the budgets. Reference capture: seed 57, (-24000, 3750), 3600 s at 10 Hz.
const baseline = { commit: '184df89de4f05087194fdc25e36ddd83a7ba0181', start: { x: -24000, z: 3750 }, peakVerticalSpeed: 511.63911809568475, flappingSeconds: 164.8 };

test('one hour through Highlands keeps clearance and flight energy bounded', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/?smoke');
  const metrics = await page.evaluate(async () => {
    const worldPath = '/src/world.ts';
    const eaglePath = '/src/eagle.ts';
    const { WorldModel } = await import(/* @vite-ignore */ worldPath) as typeof import('../src/world');
    const { EagleNavigator, TERRAIN_SAFETY_MARGIN } = await import(/* @vite-ignore */ eaglePath) as typeof import('../src/eagle');
    const world = new WorldModel(57);
    const nav = new EagleNavigator(world, { x: -84000, z: 122000, heading: 0 });
    let minClearance = Infinity;
    let peakVerticalSpeed = 0;
    let flappingSeconds = 0;
    let safetyCorrections = 0;
    let highlandSeconds = 0;
    for (let step = 0; step < 36000; step += 1) {
      const y = nav.state.y;
      const state = nav.update(0.1);
      const sample = world.sample(state.x, state.z);
      const clearance = state.y - sample.height;
      minClearance = Math.min(minClearance, clearance);
      peakVerticalSpeed = Math.max(peakVerticalSpeed, Math.abs(state.y - y) / 0.1);
      if (state.flapping) flappingSeconds += 0.1;
      if (clearance <= TERRAIN_SAFETY_MARGIN + 0.001) safetyCorrections += 1;
      if (sample.mountainRegion > 0.5) highlandSeconds += 0.1;
      if (step % 100 === 0) world.trim(20000);
    }
    return { seed: 57, start: { x: -84000, z: 122000, heading: 0 }, seconds: 3600, minClearance, peakVerticalSpeed, flappingSeconds, safetyCorrections, highlandSeconds };
  });
  await writeFile('test-results/highlands-navigation.json', JSON.stringify({ baseline, metrics }, null, 2));
  await testInfo.attach('highlands-navigation', { body: JSON.stringify({ baseline, metrics }), contentType: 'application/json' });
  expect(metrics.minClearance).toBeGreaterThan(6);
  expect(metrics.safetyCorrections).toBe(0);
  expect(metrics.highlandSeconds).toBeGreaterThan(1800);
  expect(metrics.peakVerticalSpeed).toBeLessThan(baseline.peakVerticalSpeed);
  expect(metrics.flappingSeconds).toBeLessThanOrEqual(baseline.flappingSeconds * 1.25);
});

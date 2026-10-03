import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Failure modes: collision-floor corrections mask late climbs; thermal ceilings cause
// vertical jumps; lattice interpolation erases snow-height crests; snow leaks onto
// steep rock or water. Keep #57's clearance and vertical-speed checks. Total flap
// time is recorded, not capped. Reference: seed 57, (-24000, 3750), 3600 s at 10 Hz.
// #93 and merged #86 hills change thermal choices; start 500 m west of the original fixture.
// #60 adds ridge-soaring: it must occur, climb without flapping, never pass the
// flight-height ceiling, and no behaviour episode may exceed four minutes.
const baseline = { commit: '184df89de4f05087194fdc25e36ddd83a7ba0181', start: { x: -24000, z: 3750 }, peakVerticalSpeed: 511.63911809568475, flappingSeconds: 164.8 };

test('one hour through Highlands keeps clearance and climb behavior safe', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/?smoke');
  const metrics = await page.evaluate(async () => {
    const worldPath = '/src/world.ts';
    const eaglePath = '/src/eagle.ts';
    const { WorldModel } = await import(/* @vite-ignore */ worldPath) as typeof import('../src/world');
    const { DEFAULT_FLIGHT_HEIGHT, EagleNavigator, TERRAIN_SAFETY_MARGIN } = await import(/* @vite-ignore */ eaglePath) as typeof import('../src/eagle');
    const world = new WorldModel(57);
    const nav = new EagleNavigator(world, { x: -84500, z: 122000, heading: 0 });
    let episode = { behavior: nav.state.behavior as string, seconds: 0 };
    const longestEpisode: Record<string, number> = {};
    let ridgeEpisodes = 0;
    let ridgeSeconds = 0;
    let ridgeClimb = 0;
    let ridgeFlappingTicks = 0;
    let ridgeCeilingBreaches = 0;
    let ridgeMinClearance = Infinity;
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
      if (state.behavior !== episode.behavior) {
        longestEpisode[episode.behavior] = Math.max(longestEpisode[episode.behavior] ?? 0, episode.seconds);
        if (state.behavior === 'ridge-soaring') ridgeEpisodes += 1;
        episode = { behavior: state.behavior, seconds: 0 };
      }
      episode.seconds += 0.1;
      if (state.behavior === 'ridge-soaring') {
        ridgeSeconds += 0.1;
        ridgeClimb += state.y - y;
        if (state.flapping) ridgeFlappingTicks += 1;
        if (state.y > Math.max(y, nav.flightGround + DEFAULT_FLIGHT_HEIGHT.max) + 0.001) ridgeCeilingBreaches += 1;
        ridgeMinClearance = Math.min(ridgeMinClearance, clearance);
      }
      if (step % 100 === 0) world.trim(20000);
    }
    longestEpisode[episode.behavior] = Math.max(longestEpisode[episode.behavior] ?? 0, episode.seconds);
    return {
      seed: 57, start: { x: -84500, z: 122000, heading: 0 }, seconds: 3600, minClearance, peakVerticalSpeed, flappingSeconds, safetyCorrections, highlandSeconds,
      ridgeEpisodes, ridgeSeconds, ridgeMeanClimb: ridgeSeconds > 0 ? ridgeClimb / ridgeSeconds : 0, ridgeFlappingTicks, ridgeCeilingBreaches, ridgeMinClearance, longestEpisode,
    };
  });
  await writeFile('test-results/highlands-navigation.json', JSON.stringify({ baseline, metrics }, null, 2));
  await testInfo.attach('highlands-navigation', { body: JSON.stringify({ baseline, metrics }), contentType: 'application/json' });
  expect(metrics.minClearance).toBeGreaterThan(6);
  expect(metrics.safetyCorrections).toBe(0);
  expect(metrics.highlandSeconds).toBeGreaterThan(1800);
  expect(metrics.peakVerticalSpeed).toBeLessThan(baseline.peakVerticalSpeed);
  expect(metrics.ridgeEpisodes).toBeGreaterThan(0);
  expect(metrics.ridgeFlappingTicks).toBe(0);
  expect(metrics.ridgeCeilingBreaches).toBe(0);
  expect(metrics.ridgeMinClearance).toBeGreaterThan(6);
  for (const seconds of Object.values(metrics.longestEpisode)) expect(seconds).toBeLessThanOrEqual(240);
});

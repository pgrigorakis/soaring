import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('puff faces follow sky light and night exposure decreases without a global grade', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '1406157560');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
    localStorage.setItem('soaring.settings.v1', JSON.stringify({
      muted: true, lowPower: false, cameraDistance: 100, terrainVisibility: 720,
      showThermal: false, minFlightHeight: 470, maxFlightHeight: 500,
    }));
  });
  await page.goto('/?smoke&profile');
  await page.evaluate(() => window.__SOARING__.reviewFlight!({ x: 0, z: 0, heading: 4.8 }));
  const evidence = [];
  for (const elevation of [52, 3, -6, -12, -52]) {
    const phase = Math.acos(-elevation / 52) / (2 * Math.PI);
    const frame = await page.evaluate((phase) => {
      window.__SOARING__.setTimeOfDay(phase);
      return window.__SOARING__.snapshot().renderedFrames;
    }, phase);
    await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame + 4, frame);
    const state = await page.evaluate(() => ({
      lighting: window.__SOARING__.snapshot(),
      puffs: window.__SOARING__.puffCloudSnapshot(),
    }));
    // Read the actual renderer and shader uniforms, not a second lighting formula.
    const { lighting, puffs } = state;
    expect(Math.asin(lighting.sunElevation) * 180 / Math.PI).toBeCloseTo(elevation, 4);
    expect(puffs.skyLight.every(Number.isFinite)).toBe(true);
    if (elevation === 52) {
      expect(lighting.exposure).toBeCloseTo(1, 6);
      expect(puffs.skyLight[2]).toBeGreaterThan(0.95);
    } else if (elevation === 3) {
      expect(puffs.skyLight[0]).toBeGreaterThan(puffs.skyLight[1]!);
      expect(puffs.skyLight[1]).toBeGreaterThan(puffs.skyLight[2]!);
    } else if (elevation === -52) {
      expect(lighting.exposure).toBeCloseTo(0.8, 6);
      expect(lighting.hemisphereIntensity).toBeCloseTo(0.65, 6);
      expect(Math.max(...puffs.skyLight)).toBeLessThanOrEqual(0.3);
      expect(puffs.skyLight[2]).toBeGreaterThan(puffs.skyLight[0]!);
    }
    evidence.push({ elevation, phase, exposure: lighting.exposure, hemisphere: lighting.hemisphereIntensity, skyLight: puffs.skyLight });
  }
  expect(evidence.map(({ exposure }) => exposure)).toEqual([...evidence.map(({ exposure }) => exposure)].sort((a, b) => b - a));
  const path = testInfo.outputPath('sky-lighting.json');
  await writeFile(path, JSON.stringify(evidence, null, 2));
  await testInfo.attach('sky-lighting', { path, contentType: 'application/json' });
  const screenshot = await page.screenshot({ path: testInfo.outputPath('night-chase.png') });
  await testInfo.attach('night-chase', { body: screenshot, contentType: 'image/png' });
});

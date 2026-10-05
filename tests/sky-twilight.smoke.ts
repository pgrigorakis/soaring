import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { captureScreen } from './screen-pixels';

// 1280 × 800 at a 48° vertical field of view.
const FOCAL = 400 / Math.tan(24 * Math.PI / 180);
const phaseAt = (elevation: number) => Math.acos(-elevation / 52) / (2 * Math.PI);

test('a painted twilight gradient keeps the dusk sky lit and fades out without a step', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '1406157560');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
    localStorage.setItem('soaring.settings.v1', JSON.stringify({
      muted: true, cameraDistance: 100, terrainVisibility: 720,
      showThermal: false,
    }));
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?smoke&profile');
  await page.evaluate(() => {
    const api = window.__SOARING__;
    api.reviewFlight!({ x: 0, y: api.sample(0, 0).height + 470, z: 0, heading: 0 });
    api.setCapturePixelRatio(1);
    api.setPuffCloudsVisible(false);
    api.setCloudCoverage(0);
    document.querySelector('#intro')?.remove();
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
    document.querySelector<HTMLElement>('.minimap')!.style.visibility = 'hidden';
  });

  // The gradient is full from sunset to nautical dusk and gone by +6 and -12 degrees.
  const schedule: Record<string, number> = {};
  for (const elevation of [8, 6, 1, -5, -10, -12, -14]) {
    const frame = await page.evaluate((phase) => {
      window.__SOARING__.setTimeOfDay(phase);
      return window.__SOARING__.snapshot().renderedFrames;
    }, phaseAt(elevation));
    await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame + 1, frame);
    schedule[elevation] = await page.evaluate(() => window.__SOARING__.snapshot().twilightAmount);
  }

  // Hold the camera below the cloud deck gates, pitched 20 degrees up, toward or away from the sun.
  async function view(name: string, elevation: number, side: 1 | -1) {
    const frame = await page.evaluate(({ phase, side }) => {
      const api = window.__SOARING__;
      api.setTimeOfDay(phase);
      const sun = api.snapshot().sunDirection;
      const flat = Math.hypot(sun[0]!, sun[2]!);
      const y = 360;
      const pitch = 20 * Math.PI / 180;
      api.setViewpoint({ x: 0, y, z: 0,
        lookX: side * sun[0]! / flat * Math.cos(pitch) * 1000, lookY: y + Math.sin(pitch) * 1000, lookZ: side * sun[2]! / flat * Math.cos(pitch) * 1000 });
      return api.snapshot().renderedFrames;
    }, { phase: phaseAt(elevation), side });
    await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame + 4, frame);
    await captureScreen(page, testInfo.outputPath(`${name}.png`));
  }
  // Mean colour of a box at an elevation (degrees) on the middle column.
  const meanAt = (elevation: number) => page.evaluate((row) => {
    const { data, width } = window.__screen!;
    const sum = [0, 0, 0];
    for (let y = row - 8; y <= row + 8; y += 1) {
      for (let x = width / 2 - 40; x <= width / 2 + 40; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) sum[channel]! += data[(y * width + x) * 4 + channel]!;
      }
    }
    return sum.map((value) => Math.round(value / (17 * 81)));
  }, Math.round(400 - FOCAL * Math.tan((elevation - 20) * Math.PI / 180)));
  const brightness = (color: number[]) => color[0]! + color[1]! + color[2]!;

  await view('dusk-sun-side', -6, 1);
  const sunSideUpper = await meanAt(25);
  const sunSideLow = await meanAt(3);
  await view('dusk-far-side', -6, -1);
  const farSideUpper = await meanAt(25);
  // The fog target is linear; show it as screen values.
  const fog = (await page.evaluate(() => window.__SOARING__.snapshot().fog.targetColor))
    .map((value) => Math.round(255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055)));

  // Upper sky toward the sun from sunset into night, one degree at a time.
  const sweep: { elevation: number; upper: number[] }[] = [];
  for (let elevation = 2; elevation >= -14; elevation -= 1) {
    await view(`sweep${elevation}`, elevation, 1);
    sweep.push({ elevation, upper: await meanAt(25) });
  }
  const steps = sweep.slice(1).map((entry, index) => Math.abs(brightness(entry.upper) - brightness(sweep[index]!.upper)));

  const measures = { schedule, sunSideUpper, sunSideLow, farSideUpper, fog, sweep, largestStep: Math.max(...steps) };
  const path = testInfo.outputPath('sky-twilight.json');
  await writeFile(path, JSON.stringify(measures, null, 2));
  await testInfo.attach('sky-twilight', { path, contentType: 'application/json' });

  expect(schedule[8]).toBe(0);
  expect(schedule[6]).toBe(0);
  expect(schedule[1]).toBe(1);
  expect(schedule[-5]).toBe(1);
  expect(schedule[-10]).toBe(1);
  expect(schedule[-12]).toBe(0);
  expect(schedule[-14]).toBe(0);
  // Step 3 values (Preetham alone) in brackets.
  // At sun -6 degrees the sky 25 degrees up is lit, not near black, on both sides (30 and 40).
  expect(brightness(sunSideUpper)).toBeGreaterThan(180);
  expect(brightness(farSideUpper)).toBeGreaterThan(100);
  // Toward the sun it is purple, not brown: blue holds up against green.
  expect(sunSideUpper[2]!).toBeGreaterThan(sunSideUpper[1]! + 20);
  // The sun-side horizon is a saturated orange (red - blue 85).
  expect(sunSideLow[0]! - sunSideLow[2]!).toBeGreaterThan(130);
  // The fog read follows the painted horizon (155).
  expect(brightness(fog)).toBeGreaterThan(220);
  // The sky darkens smoothly into night: no one-degree step jumps (90).
  expect(Math.max(...steps)).toBeLessThan(60);
});

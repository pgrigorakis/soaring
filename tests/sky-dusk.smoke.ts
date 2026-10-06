import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { captureScreen } from './screen-pixels';

// 1280 × 800 at a 48° vertical field of view.
const FOCAL = 400 / Math.tan(24 * Math.PI / 180);

test('dusk warmth follows the sun, a rose belt faces it, and the low sun is wide', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '1406157560');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
    localStorage.setItem('soaring.settings.v1', JSON.stringify({
      muted: true, cameraDistance: 100,
      showThermal: false,
    }));
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?smoke&profile');
  const sunElevation = 2;
  const sun = await page.evaluate((phase) => {
    const api = window.__SOARING__;
    api.reviewFlight!({ x: 0, y: api.sample(0, 0).height + 470, z: 0, heading: 0 });
    api.setCapturePixelRatio(1);
    api.setPuffCloudsVisible(false);
    api.setTimeOfDay(phase);
    document.querySelector('#intro')?.remove();
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
    document.querySelector<HTMLElement>('.minimap')!.style.visibility = 'hidden';
    return api.snapshot().sunDirection;
  }, Math.acos(-sunElevation / 52) / (2 * Math.PI));
  const flat = Math.hypot(sun[0]!, sun[2]!);
  const toSun = [sun[0]! / flat, sun[2]! / flat] as const;

  // Hold the camera 900 m over the ground, level with the horizon band, and read one screenshot.
  async function view(name: string, side: 1 | -1, centre: number, coverage: number) {
    const frame = await page.evaluate(({ side, centre, coverage, toSun }) => {
      const api = window.__SOARING__;
      const y = api.sample(0, 0).height + 900;
      const pitch = centre * Math.PI / 180;
      api.setCloudCoverage(coverage);
      api.setViewpoint({ x: 0, y, z: 0,
        lookX: side * toSun[0] * Math.cos(pitch) * 1000, lookY: y + Math.sin(pitch) * 1000, lookZ: side * toSun[1] * Math.cos(pitch) * 1000 });
      return api.snapshot().renderedFrames;
    }, { side, centre, coverage, toSun });
    await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame + 4, frame);
    await captureScreen(page, testInfo.outputPath(`${name}.png`));
  }
  // Mean colour of a box centred at an elevation (degrees) and a pixel offset from the middle column.
  const meanAt = (elevation: number, centre: number, dx: number, half = 6) => page.evaluate(({ row, dx, half }) => {
    const { data, width } = window.__screen!;
    const sum = [0, 0, 0];
    for (let y = row - half; y <= row + half; y += 1) {
      for (let x = width / 2 + dx - half; x <= width / 2 + dx + half; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) sum[channel]! += data[(y * width + x) * 4 + channel]!;
      }
    }
    return sum.map((value) => value / (2 * half + 1) ** 2);
  }, { row: Math.round(400 - FOCAL * Math.tan((elevation - centre) * Math.PI / 180)), dx, half });
  const warmth = ([r, , b]: number[]) => r! - b!;

  await view('sun-side', 1, 6, 0);
  const sunRow = Math.round(400 - FOCAL * Math.tan((sunElevation - 6) * Math.PI / 180));
  const sunWidth = await page.evaluate((row) => {
    const { data, width } = window.__screen!;
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      // The orange glow keeps green low; the pale disc lifts it.
      if (data[(row * width + x) * 4 + 1]! >= 205) count += 1;
    }
    return count;
  }, sunRow);
  const sunSide = [await meanAt(5, 6, -260), await meanAt(5, 6, 260)];
  const sunGlow = await meanAt(14, 6, 0);
  await view('anti-sun', -1, 6, 0);
  const antiSide = [await meanAt(5, 6, -260), await meanAt(5, 6, 260)];
  const belt = await meanAt(4, 6, 0);
  await view('clouds-sun', 1, 25, 1);
  const cloudsSun = await meanAt(25, 25, 0, 150);
  await view('clouds-anti', -1, 25, 1);
  const cloudsAnti = await meanAt(25, 25, 0, 150);

  const measures = { sunElevation, sunWidth, sunSide, sunGlow, antiSide, belt, cloudsSun, cloudsAnti };
  const path = testInfo.outputPath('sky-dusk.json');
  await writeFile(path, JSON.stringify(measures, null, 2));
  await testInfo.attach('sky-dusk', { path, contentType: 'application/json' });
  // Old values (one warm band everywhere, a 1.1 degree core) in brackets.
  // The sun reads about 3 degrees across (37 px).
  expect(sunWidth).toBeGreaterThanOrEqual(45);
  // Warmth is directional: the sun side is far warmer than the far side (3).
  expect(warmth(sunSide[0]!) - warmth(antiSide[0]!)).toBeGreaterThan(40);
  expect(warmth(sunSide[1]!) - warmth(antiSide[1]!)).toBeGreaterThan(40);
  // A broad low-sun glow lights the sky 12 degrees above the sun (red 183).
  expect(sunGlow[0]).toBeGreaterThan(215);
  // Opposite the sun the belt is rose, not brown: blue holds up against red (0.52).
  expect(belt[2]! / belt[0]!).toBeGreaterThan(0.6);
  // Painted clouds burn toward the sun and stay cool opposite it (-3).
  expect(warmth(cloudsSun) - warmth(cloudsAnti)).toBeGreaterThan(30);
});

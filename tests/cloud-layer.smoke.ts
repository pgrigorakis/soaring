import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Failure modes: bird-height rather than camera-height gates; a clear nearby bird
// inside; dry ground showing through above; alpha holes/far fade; rebase moving
// the deck; no natural crossing; flight safety lost to scheduled descent.
const HEIGHT_SCALE = 600 / 520;
const VIEWS = [
  { name: 'below', cameraY: 300 * HEIGHT_SCALE },
  { name: 'inside', cameraY: 500 * HEIGHT_SCALE },
  { name: 'above', cameraY: 710 * HEIGHT_SCALE },
] as const;

test('cloud deck hides low ground above and whites out the chase bird inside', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '448122');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
  });
  await page.goto('/?smoke&profile');
  const place = await page.evaluate(() => window.__SOARING__.reviewSpots().lake);
  await page.evaluate(() => {
    window.__SOARING__.setVisibility(1440);
    window.__SOARING__.setTimeOfDay(0.5);
    document.querySelector('#intro')?.classList.add('hidden');
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
    document.querySelector<HTMLElement>('.minimap')!.style.visibility = 'hidden';
  });
  const shots: Array<Record<string, unknown>> = [];
  for (const view of VIEWS) {
    const frame = await page.evaluate(({ place, cameraY }) => {
      const api = window.__SOARING__;
      api.reviewFlight!({ x: place.x, z: place.z, heading: 0.4, y: cameraY - api.snapshot().cameraHeight });
      return api.snapshot().renderedFrames;
    }, { place, cameraY: view.cameraY });
    // Stream at the smoke ratio. Full-resolution software frames would slow the
    // frame-bound terrain budget about 16-fold on CI.
    await page.waitForFunction((frame) => {
      const s = window.__SOARING__.snapshot();
      return s.pending === 0 && s.renderedFrames > frame;
    }, frame, { timeout: 300_000 });
    const captureFrame = await page.evaluate(() => {
      window.__SOARING__.setCapturePixelRatio(1);
      return window.__SOARING__.snapshot().renderedFrames;
    });
    await page.waitForFunction((frame) => {
      const s = window.__SOARING__.snapshot();
      return s.pending === 0 && s.renderedFrames > frame + 8;
    }, captureFrame, { timeout: 120_000 });
    const state = await page.evaluate(() => window.__SOARING__.snapshot());
    await mkdir('test-results/cloud-layer', { recursive: true });
    const image = await page.screenshot({ path: `test-results/cloud-layer/${view.name}.png` });
    await page.evaluate(() => window.__SOARING__.setCapturePixelRatio(0.25));
    await testInfo.attach(view.name, { body: image, contentType: 'image/png' });
    // Read the real browser screenshot, not a synthetic shader or diagnostic-only value.
    const pixels = await page.evaluate(async (data) => {
      const image = new Image(); image.src = data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const pixel = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0, count = 0, sum = 0, square = 0, rowDeviation = 0;
      // Anything whiteout misses, such as distant tree crowns or puffs, stands out from its row.
      for (let y = 0; y < canvas.height; y++) {
        const row = Array.from({ length: canvas.width }, (_, x) => {
          const i = (y * canvas.width + x) * 4;
          return (pixel[i]! + pixel[i + 1]! + pixel[i + 2]!) / 3;
        });
        const mean = row.reduce((total, luma) => total + luma, 0) / row.length;
        for (const luma of row) rowDeviation = Math.max(rowDeviation, Math.abs(luma - mean));
      }
      // Chase bird and nearby ground occupy the middle/lower frame.
      for (let y = 400; y < 760; y++) for (let x = 420; x < 1020; x++) {
        const i = (y * canvas.width + x) * 4;
        const luma = (pixel[i]! + pixel[i + 1]! + pixel[i + 2]!) / 3;
        if (luma < 90) dark++;
        sum += luma; square += luma * luma; count++;
      }
      return { darkFraction: dark / count, rowDeviation, mean: sum / count, variance: square / count - (sum / count) ** 2 };
    }, `data:image/png;base64,${image.toString('base64')}`);
    shots.push({ ...view, state, pixels });
  }
  await writeFile('test-results/cloud-layer/poses.json', JSON.stringify({ seed: 448122, place, shots }, null, 2));
  expect(errors).toEqual([]);
  const below = shots[0]!.state as ReturnType<typeof window.__SOARING__.snapshot>;
  const inside = shots[1]!.state as ReturnType<typeof window.__SOARING__.snapshot>;
  const above = shots[2]!.state as ReturnType<typeof window.__SOARING__.snapshot>;
  const layer = (s: typeof below) => (s as typeof s & { cloudLayer?: { above: number; whiteout: number; opacity: number; visible: boolean } }).cloudLayer;
  expect(layer(below)?.visible).toBe(false);
  expect(layer(inside)?.whiteout).toBeCloseTo(0.996, 5);
  expect(layer(above)?.opacity).toBe(0.94);
  const belowPixels = shots[0]!.pixels as { darkFraction: number; rowDeviation: number; variance: number };
  const insidePixels = shots[1]!.pixels as typeof belowPixels;
  expect(belowPixels.darkFraction).toBeGreaterThan(0.005);
  expect(insidePixels.darkFraction).toBe(0);
  expect(insidePixels.rowDeviation).toBeLessThan(8);
  expect(insidePixels.variance).toBeLessThan(belowPixels.variance * 0.1);
});

// Use the real navigator and procedural world. A complete repeatable trace is
// emitted even if an assertion fails. It covers two flight cycles from the lake.
// Seed 5914: from the 448122 lake, the 7 km land field keeps the second cycle over high ground.
test('the lowland flight cycle climbs through the cloud deck without collision-floor jumps', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/?smoke');
  const metrics = await page.evaluate(async () => {
    const worldPath = '/src/world.ts';
    const eaglePath = '/src/eagle.ts';
    const { WorldModel } = await import(/* @vite-ignore */ worldPath) as typeof import('../src/world');
    const { EagleNavigator, TERRAIN_SAFETY_MARGIN } = await import(/* @vite-ignore */ eaglePath) as typeof import('../src/eagle');
    const world = new WorldModel(5914);
    const lake = world.reviewSpots().lake;
    const nav = new EagleNavigator(world, { x: lake.x, z: lake.z, heading: 0.4 });
    let minClearance = Infinity, corrections = 0, climb = 0, dive = 0;
    const trace: Array<Record<string, unknown>> = [];
    for (let step = 0; step < 13000; step++) {
      const y = nav.state.y;
      const state = nav.update(0.1);
      const sample = world.sample(state.x, state.z);
      const clearance = state.y - Math.max(sample.height, sample.water ? sample.surface : sample.height);
      minClearance = Math.min(minClearance, clearance);
      if (clearance <= TERRAIN_SAFETY_MARGIN + 0.001) corrections++;
      climb = Math.max(climb, (state.y - y) / 0.1);
      dive = Math.max(dive, (y - state.y) / 0.1);
      if (step % 10 === 0) trace.push({ t: (step + 1) / 10, y: state.y, clearance, phase: nav.cycle.phase, top: nav.cycle.top });
      if (step % 100 === 0) world.trim(20000);
    }
    return { seed: 5914, lake, minClearance, corrections, climb, dive, trace };
  });
  await writeFile('test-results/cloud-crossing.json', JSON.stringify(metrics, null, 2));
  await testInfo.attach('cloud-crossing', { body: JSON.stringify(metrics), contentType: 'application/json' });
  expect(metrics.minClearance).toBeGreaterThan(6);
  expect(metrics.corrections).toBe(0);
  // Thermals climb at up to 4 m/s and dives sink at up to 6 m/s: no floor jumps.
  expect(metrics.climb).toBeLessThanOrEqual(4.001);
  expect(metrics.dive).toBeLessThanOrEqual(6.001);
  const y = metrics.trace.map((point) => point.y as number);
  // Lowland climbs end near 700 m above sea level, through the 600 m deck and not far past it.
  expect(Math.max(...y)).toBeGreaterThan(650);
  const lowland = metrics.trace.filter((point) => (point.y as number) - (point.clearance as number) < 400);
  expect(Math.max(...lowland.map((point) => point.y as number))).toBeLessThan(750 + 4);
  // Each climb is followed by a dive to the low cruise, under the deck again.
  const phases = metrics.trace.map((point) => point.phase as string);
  expect(phases.filter((phase, index) => phase === 'dive' && phases[index - 1] === 'lift').length).toBeGreaterThanOrEqual(2);
  expect(Math.min(...metrics.trace.filter((point) => point.phase === 'cruise' && (point.t as number) > 300).map((point) => point.clearance as number))).toBeLessThan(190);
});

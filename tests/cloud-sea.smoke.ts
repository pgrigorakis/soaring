import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const SEED = '448122';
const ARTIFACT_DIR = 'test-results/cloud-sea';
const PHASES = [
  { name: 'dawn', phase: 0.27 },
  { name: 'fade', phase: 0.483333 },
  { name: 'after', phase: 0.55 },
] as const;

test('morning mist lies over a lake and is absent over dry ground', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript((seed) => {
    localStorage.setItem('soaring.world-seed.v1', seed);
  }, SEED);
  await page.goto('/?smoke');
  await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0, undefined, { timeout: 120_000 });

  const places = await page.evaluate(() => {
    const lake = window.__SOARING__.reviewSpots().lake;
    let dry: { x: number; z: number; moisture: number } | null = null;
    // A short walk out from the lake. A full grid of world samples blocks the software renderer.
    for (let radius = 1500; radius <= 12000 && !dry; radius += 1000) {
      for (let step = 0; step < 12; step += 1) {
        const angle = step * Math.PI / 6;
        const x = lake.x + Math.cos(angle) * radius;
        const z = lake.z + Math.sin(angle) * radius;
        const sample = window.__SOARING__.mistAt(x, z);
        if (sample.water || sample.bank < 400 || sample.cover > 0) continue;
        dry = { x, z, moisture: sample.moisture };
        break;
      }
    }
    return { lake, lakeMist: window.__SOARING__.mistAt(lake.x, lake.z), dry };
  });
  expect(places.lakeMist.water).toBe(true);
  expect(places.lakeMist.cover).toBe(1);
  expect(places.dry).not.toBeNull();
  expect(places.dry!.moisture).toBeLessThan(0.55);

  await mkdir(ARTIFACT_DIR, { recursive: true });
  const shots: Array<Record<string, unknown>> = [];
  for (const place of [
    { label: 'lake', x: places.lake.x, z: places.lake.z },
    { label: 'dry', x: places.dry!.x, z: places.dry!.z },
  ]) {
    await page.evaluate((pose) => {
      window.__SOARING__.reviewFlight!({ x: pose.x, z: pose.z, heading: 0.4 });
      window.__SOARING__.setVisibility(720);
      document.querySelector('#intro')?.classList.add('hidden');
      document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
    }, place);
    const posed = await page.evaluate(() => window.__SOARING__.snapshot().renderedFrames);
    await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame, posed);
    await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0, undefined, { timeout: 180_000 });
    await page.evaluate(() => window.__SOARING__.fillMist(30_000));
    expect(await page.evaluate(() => window.__SOARING__.snapshot().mistReady)).toBe(true);
    for (const { name, phase } of PHASES) {
      const frame = await page.evaluate((value) => {
        window.__SOARING__.setTimeOfDay(value);
        return window.__SOARING__.snapshot().renderedFrames;
      }, phase);
      await page.waitForFunction((previous) => {
        const state = window.__SOARING__.snapshot();
        return state.renderedFrames > previous + 2 && state.mistReady && state.pending === 0;
      }, frame);
      const state = await page.evaluate(() => {
        const snapshot = window.__SOARING__.snapshot();
        return { morningMist: snapshot.morningMist, timeOfDay: snapshot.timeOfDay, position: snapshot.position };
      });
      const file = `${ARTIFACT_DIR}/${place.label}-${name}.png`;
      const image = await page.screenshot({ path: file });
      await testInfo.attach(`${place.label}-${name}`, { body: image, contentType: 'image/png' });
      shots.push({ place: place.label, name, phase, ...state, file });
    }
  }
  await writeFile(`${ARTIFACT_DIR}/poses.json`, JSON.stringify({ seed: SEED, places, shots }, null, 2));
  expect(errors).toEqual([]);
  const byName = (place: string, name: string) => shots.find((shot) => shot.place === place && shot.name === name);
  expect(byName('lake', 'dawn')?.morningMist).toBe(1);
  expect(byName('lake', 'fade')?.morningMist).toBeCloseTo(0.5, 1);
  expect(byName('lake', 'after')?.morningMist).toBe(0);
  expect(byName('dry', 'dawn')?.morningMist).toBe(1);
  expect(byName('dry', 'after')?.morningMist).toBe(0);
});

import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { milkyWayUniforms } from '../src/milky-way';
import { captureScreen } from './screen-pixels';

// The evening side of the arc, as a day phase, for a sun elevation in degrees.
const duskPhase = (elevation: number) => 1 - Math.acos(-elevation / 52) / (2 * Math.PI);
const toDeg = THREE.MathUtils.radToDeg;

// A point on the band at least 32 degrees up, so the measured box clears the aurora below 20 degrees,
// and a point at the same elevation far off the band.
const pole = milkyWayUniforms.milkyWayPole.value;
const centre = milkyWayUniforms.milkyWayCentre.value;
const east = new THREE.Vector3().crossVectors(pole, centre);
const onBand = centre.clone();
for (let longitude = 0; onBand.y < Math.sin(32 * Math.PI / 180); longitude += 0.02) {
  onBand.copy(centre).multiplyScalar(Math.cos(longitude)).addScaledVector(east, Math.sin(longitude));
}
const offBand = onBand.clone();
while (Math.abs(offBand.dot(pole)) < 0.6) offBand.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.05);

test('the Milky Way shows on a dark night and fades with dusk and moonlight', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '1406157560');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
    localStorage.setItem('soaring.settings.v1', JSON.stringify({
      muted: true, lowPower: false, cameraDistance: 100, terrainVisibility: 720,
      showThermal: false, minFlightHeight: 470, maxFlightHeight: 500,
    }));
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?smoke&profile');
  await page.evaluate(() => {
    const api = window.__SOARING__;
    api.reviewFlight!({ x: 0, z: 0, heading: 0 });
    api.setCapturePixelRatio(1);
    api.setPuffCloudsVisible(false);
    api.setCloudCoverage(0);
    document.querySelector('#intro')?.remove();
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
    document.querySelector<HTMLElement>('.minimap')!.style.visibility = 'hidden';
  });

  // Hold the camera 900 m over the ground, look straight at one sky direction, and read the frame's middle.
  async function look(name: string, direction: THREE.Vector3) {
    const frame = await page.evaluate(([x, y, z]) => {
      const api = window.__SOARING__;
      const height = api.sample(0, 0).height + 900;
      api.setViewpoint({ x: 0, y: height, z: 0, lookX: x! * 1000, lookY: height + y! * 1000, lookZ: z! * 1000 });
      return api.snapshot().renderedFrames;
    }, direction.toArray());
    await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame + 4, frame);
    await captureScreen(page, testInfo.outputPath(`${name}.png`));
    // Mean brightness of a 241 px box, so single stars average out.
    return page.evaluate(() => {
      const { data, width, height } = window.__screen!;
      let sum = 0;
      for (let y = height / 2 - 120; y <= height / 2 + 120; y += 1) {
        for (let x = width / 2 - 120; x <= width / 2 + 120; x += 1) {
          const i = (y * width + x) * 4;
          sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
        }
      }
      return sum / 241 ** 2;
    });
  }
  // How much brighter the band is than the sky beside it, at one sun height and moon day, under a clear sky.
  async function contrast(name: string, sunElevation: number, day: number) {
    await page.evaluate(({ phase, day }) => window.__SOARING__.setTimeOfDay(phase, day), { phase: duskPhase(sunElevation), day });
    const band = await look(`${name}-band`, onBand);
    const beside = await look(`${name}-beside`, offBand);
    // The frame loop applies the sky, so read it after the frames have drawn.
    const sky = await page.evaluate(() => {
      const { sunElevation, moonElevation, moonLit, milkyWayAmount, auroraAmount } = window.__SOARING__.snapshot();
      return { sunElevation, moonElevation, moonLit, milkyWayAmount, auroraAmount };
    });
    return { name, ...sky, band, beside, contrast: band - beside };
  }

  const dark = await contrast('dark', -52, 4);
  const deepDusk = await contrast('dusk-18', -18, 4);
  const dusk = await contrast('dusk-6', -6, 4);
  const fullMoon = await contrast('full-moon', -52, 0);

  const measures = {
    onBand: { elevation: toDeg(Math.asin(onBand.y)), azimuth: toDeg(Math.atan2(onBand.x, onBand.z)) },
    offBand: { elevation: toDeg(Math.asin(offBand.y)), azimuth: toDeg(Math.atan2(offBand.x, offBand.z)) },
    dark, deepDusk, dusk, fullMoon,
  };
  const path = testInfo.outputPath('milky-way.json');
  await writeFile(path, JSON.stringify(measures, null, 2));
  await testInfo.attach('milky-way', { path, contentType: 'application/json' });

  // On a dark, clear night the band is plainly brighter than the sky beside it.
  expect(dark.moonElevation * dark.moonLit).toBeLessThan(0.05);
  expect(dark.milkyWayAmount).toBe(1);
  // About 7 levels on hardware; about -0.2 without the band.
  expect(dark.contrast).toBeGreaterThan(4);
  // Dusk: nothing at -6 degrees, full by -18 degrees.
  expect(dusk.milkyWayAmount).toBeLessThan(0.01);
  expect(Math.abs(dusk.contrast)).toBeLessThan(1);
  expect(deepDusk.milkyWayAmount).toBeGreaterThan(0.95);
  expect(deepDusk.contrast).toBeGreaterThan(dark.contrast * 0.7);
  // A high full moon hides most of the band.
  expect(fullMoon.moonElevation).toBeGreaterThan(0.25);
  expect(fullMoon.contrast).toBeLessThan(dark.contrast * 0.35);
});

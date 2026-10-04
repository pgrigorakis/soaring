import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { captureScreen } from './screen-pixels';

// The evening side of the arc, as a day phase, for a sun elevation in degrees.
const duskPhase = (elevation: number) => 1 - Math.acos(-elevation / 52) / (2 * Math.PI);

test('the moon shows real phases, its light follows the lit fraction, and the shadow caster switches dark', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
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
    api.lookAtBody('moon');
    document.querySelector('#intro')?.remove();
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
  });

  async function settle(phase: number, day: number) {
    const frame = await page.evaluate(({ phase, day }) => {
      window.__SOARING__.setTimeOfDay(phase, day);
      return window.__SOARING__.snapshot().renderedFrames;
    }, { phase, day });
    await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame + 4, frame);
    return page.evaluate(() => {
      const { moonLit, moonIntensity, sunElevation, moonElevation, dominant } = window.__SOARING__.snapshot();
      return { moonLit, moonIntensity, sunElevation, moonElevation, dominant };
    });
  }

  // The camera looks at the moon, so the disc (about 27 px in radius) sits at the centre of the frame.
  // Sun at -20 degrees after dusk on days 0, 5, 6 and 7 of the 8-day month: full, crescent, half, gibbous.
  type Phase = Awaited<ReturnType<typeof settle>> & { name: string; day: number; litShare: number; partial: number; halo: number };
  const phases: Phase[] = [];
  for (const [name, day] of [['full', 0], ['crescent', 5], ['half', 6], ['gibbous', 7]] as const) {
    const body = await settle(duskPhase(-20), day);
    await captureScreen(page, testInfo.outputPath(`moon-${name}.png`));
    const screen = await page.evaluate(() => {
      const { data, width, height } = window.__screen!;
      const luma = (x: number, y: number) => {
        const index = (y * width + x) * 4;
        return 0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!;
      };
      let inside = 0;
      let lit = 0;
      let partial = 0;
      for (let y = -24; y <= 24; y += 1) {
        for (let x = -24; x <= 24; x += 1) {
          if (x * x + y * y > 24 * 24) continue;
          const value = luma(width / 2 + x, height / 2 + y);
          inside += 1;
          if (value > 120) lit += 1;
          if (value > 60 && value < 120) partial += 1;
        }
      }
      // The halo 60 px out, beside the disc.
      const halo = (luma(width / 2 + 60, height / 2) + luma(width / 2 - 60, height / 2)
        + luma(width / 2, height / 2 + 60) + luma(width / 2, height / 2 - 60)) / 4;
      return { litShare: lit / inside, partial, halo };
    });
    phases.push({ name, day, ...body, ...screen });
  }

  // Sunset under a half moon high in the sky: the shadow caster switches while both lights are dark.
  const sunset = [];
  for (const elevation of [1, 0.2, -0.2, -1, -3, -6]) sunset.push({ elevation, ...(await settle(duskPhase(elevation), 6)) });

  const path = testInfo.outputPath('moon-phases.json');
  await writeFile(path, JSON.stringify({ phases, sunset }, null, 2));
  await testInfo.attach('moon-phases', { path, contentType: 'application/json' });

  const byName = Object.fromEntries(phases.map((entry) => [entry.name, entry]));
  for (const entry of phases) {
    expect(entry.moonElevation).toBeGreaterThan(0.25);
    // The rendered lit share of the disc matches the lit fraction.
    expect(Math.abs(entry.litShare - entry.moonLit)).toBeLessThan(0.12);
    // Moonlight is the height ramp (peak 1.7, full at the 52 degree peak) times the lit fraction.
    const t = Math.min(1, entry.moonElevation / Math.sin(52 * Math.PI / 180));
    expect(entry.moonIntensity).toBeCloseTo(1.7 * t * t * (3 - 2 * t) * entry.moonLit, 3);
  }
  expect(byName.full!.moonLit).toBeGreaterThan(0.99);
  expect(byName.crescent!.moonLit).toBeLessThan(0.2);
  expect(byName.half!.moonLit).toBeGreaterThan(0.4);
  expect(byName.half!.moonLit).toBeLessThan(0.6);
  // A smooth terminator: a band of part-lit pixels between the lit face and the dark one.
  expect(byName.half!.partial).toBeGreaterThan(20);
  // The halo scales with the lit fraction.
  expect(byName.crescent!.halo).toBeLessThan(byName.half!.halo - 10);
  expect(byName.half!.halo).toBeLessThan(byName.full!.halo - 10);

  // The sun casts while it is up, the moon after. Both are dark at the switch.
  for (const entry of sunset) {
    expect(entry.dominant).toBe(entry.sunElevation >= 0 ? 'sun' : 'moon');
    expect(entry.moonElevation).toBeGreaterThan(0.5);
  }
  expect(sunset.find((entry) => entry.elevation === 0.2)!.moonIntensity).toBe(0);
  expect(sunset.find((entry) => entry.elevation === -0.2)!.moonIntensity).toBeLessThan(0.05);
  expect(sunset.find((entry) => entry.elevation === -6)!.moonIntensity).toBeGreaterThan(0.5);
});

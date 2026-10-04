import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type SkyMeasure = { centre: number; discSpread: number; halo: number; far: number; stars: number };

// Rendered sky pixels, measured in the page from a Playwright screenshot.
async function measureSky(page: Page, name: string, testInfo: { outputPath: (name: string) => string }): Promise<SkyMeasure> {
  const shot = await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
    const luma = (x: number, y: number) => {
      const index = (Math.round(y) * width + Math.round(x)) * 4;
      return 0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!;
    };
    const ring = (radius: number) => {
      let sum = 0;
      for (let step = 0; step < 32; step += 1) {
        const angle = step / 32 * Math.PI * 2;
        sum += luma(width / 2 + Math.cos(angle) * radius, height / 2 + Math.sin(angle) * radius);
      }
      return sum / 32;
    };
    const disc: number[] = [];
    for (let y = -12; y <= 12; y += 2) for (let x = -12; x <= 12; x += 2) disc.push(luma(width / 2 + x, height / 2 + y));
    // Stars: isolated bright peaks in the upper sky band, away from the moon and its halo.
    let stars = 0;
    for (let y = 4; y < height * 0.3; y += 1) {
      for (let x = 4; x < width - 4; x += 1) {
        if (Math.hypot(x - width / 2, y - height / 2) < 260) continue;
        const value = luma(x, y);
        const background = (luma(x - 4, y) + luma(x + 4, y) + luma(x, y - 4) + luma(x, y + 4)) / 4;
        if (value > background + 40 && value >= luma(x - 1, y) && value > luma(x + 1, y) && value >= luma(x, y - 1) && value > luma(x, y + 1)) stars += 1;
      }
    }
    return {
      centre: luma(width / 2, height / 2),
      discSpread: Math.max(...disc) - Math.min(...disc),
      halo: ring(60),
      far: ring(330),
      stars,
    };
  }, shot.toString('base64'));
}

test('the moon glows with a face and stars appear with the afterglow', async ({ page }, testInfo) => {
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
    // Clear painted clouds so the disc, halo and stars are measured, not cloud cover.
    api.setCloudCoverage(0);
    document.querySelector('#intro')?.remove();
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
  });

  async function showSun(elevation: number, look: 'moon' | 'chase') {
    const phase = Math.acos(-elevation / 52) / (2 * Math.PI);
    const frame = await page.evaluate(({ phase, look }) => {
      window.__SOARING__.setTimeOfDay(phase);
      window.__SOARING__.lookAtBody(look);
      return window.__SOARING__.snapshot().renderedFrames;
    }, { phase, look });
    await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame + 4, frame);
    return page.evaluate(() => window.__SOARING__.snapshot());
  }

  // FWM timing: no stars before about -2 degrees, half by -4, full by -6 while the afterglow lasts.
  const timing = [];
  for (const elevation of [-1, -2, -4, -6]) {
    const snapshot = await showSun(elevation, 'chase');
    timing.push({ elevation, starAmount: snapshot.starAmount });
  }
  expect(timing[0]!.starAmount).toBe(0);
  expect(timing[1]!.starAmount).toBeLessThan(0.01);
  expect(timing[2]!.starAmount).toBeGreaterThan(0.3);
  expect(timing[2]!.starAmount).toBeLessThan(0.7);
  expect(timing[3]!.starAmount).toBeGreaterThan(0.99);

  const midnight = await showSun(-52, 'moon');
  expect(midnight.moonElevation).toBeGreaterThan(0.7);
  const moon = await measureSky(page, 'midnight-moon', testInfo);
  // The disc stays near white without a flat clip, and its maria and limb vary across it.
  expect(moon.centre).toBeGreaterThan(200);
  expect(moon.discSpread).toBeGreaterThan(8);
  // The halo 60 px (about 3.6 degrees) out is clearly brighter than the sky 330 px (about 20 degrees) out.
  expect(moon.halo).toBeGreaterThan(moon.far + 25);
  // Coarse stars are at least 1.2 px across, so many survive as distinct peaks.
  expect(moon.stars).toBeGreaterThan(40);

  const path = testInfo.outputPath('sky-bodies.json');
  await writeFile(path, JSON.stringify({ timing, moon }, null, 2));
  await testInfo.attach('sky-bodies', { path, contentType: 'application/json' });
});

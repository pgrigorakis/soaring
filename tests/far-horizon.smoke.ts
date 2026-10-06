import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { captureScreen } from './screen-pixels';

// Failure modes: streamed ground past the fog limit draws as flat fog colour, which differs from the
// sky behind it and shows as a grey band with ridge silhouettes under the horizon; a fixed far-haze
// distance paints that band inside the visibility; the unfocused 30 fps cap reads as slow rendering
// and drops quality to its 3.5 km reach.
const OUT = 'test-results/far-horizon';

test('an unfocused window keeps its quality step and terrain reach', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?smoke');
  await page.waitForFunction(() => window.__SOARING__.snapshot().renderedFrames >= 3);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => window.__SOARING__.snapshot().frameCap)).toBe(30);
  // Quality steps down after 10 s below 40 fps; the cap holds the app at 30 fps.
  await page.waitForTimeout(12_000);
  const capped = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(capped.frameCap).toBe(30);
  expect(capped.qualityStep).toBe(0);
});

test('the far horizon shows sky, not a flat fog band, past the fog limit', async ({ page }) => {
  test.setTimeout(600_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '5');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
  });
  // ?profile holds the quality step. 3500 m is the reach that quality step 3 used to apply.
  await page.goto('/?smoke&profile');
  await page.evaluate(() => {
    const app = window.__SOARING__;
    app.setVisibility(3500);
    app.setTimeOfDay(0.616);
    // Over the sea toward land beyond the fog limit, where the band was widest.
    app.reviewFlight!({ x: 0, y: 450, z: 0, heading: 4.71 });
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
    document.querySelector<HTMLElement>('.minimap')!.style.visibility = 'hidden';
  });
  await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0, undefined, { timeout: 420_000 });
  const previous = await page.evaluate(() => {
    const s = window.__SOARING__.snapshot();
    window.__SOARING__.setCapturePixelRatio(1);
    return { renderedFrames: s.renderedFrames, fogSamples: s.fog.samples };
  });
  await page.waitForFunction((previous) => {
    const s = window.__SOARING__.snapshot();
    const fogGap = Math.hypot(...s.fog.color.map((value, index) => value - s.fog.targetColor[index]!));
    return s.renderedFrames > previous.renderedFrames + 8 && s.fog.samples > previous.fogSamples && fogGap < 1e-4;
  }, previous, { timeout: 120_000 });
  await mkdir(OUT, { recursive: true });
  await captureScreen(page, `${OUT}/horizon.png`);

  // Ground drawn fully into the fog is exactly the fog colour. Find the tallest run of it in each column.
  const evidence = await page.evaluate(() => {
    const s = window.__SOARING__.snapshot();
    const encode = (linear: number) => 255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);
    const fog = s.fog.color.map(encode);
    const { data, width, height } = window.__screen!;
    const runs: number[] = [];
    for (let x = 0; x < width; x += 4) {
      let run = 0;
      let tallest = 0;
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        const isFog = Math.abs(data[i]! - fog[0]!) <= 3 && Math.abs(data[i + 1]! - fog[1]!) <= 3 && Math.abs(data[i + 2]! - fog[2]!) <= 3;
        run = isFog ? run + 1 : 0;
        tallest = Math.max(tallest, run);
      }
      runs.push(tallest);
    }
    runs.sort((a, b) => a - b);
    return { fog, height, visibleDistance: s.visibleDistance, ground: s.ground,
      medianRun: runs[Math.floor(runs.length / 2)]!, p90Run: runs[Math.floor(runs.length * 0.9)]! };
  });
  await writeFile(`${OUT}/evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  // The band was about 5% of the frame height in every column. The fog-to-sky seam is a few pixels.
  expect(evidence.medianRun).toBeLessThan(evidence.height * 0.01);
});

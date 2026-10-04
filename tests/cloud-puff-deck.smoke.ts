import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Failure modes: puffs at the deck height poke above the deck's horizon when the
// camera is just above it; the fix hides puffs below the deck too; puffs leak at
// night, when the deck is dark and a sky-lit puff stands out most.
const VIEWS = [
  { name: 'above-noon', cameraY: 680, phase: 0.5 },
  { name: 'above-night', cameraY: 680, phase: 0.02 },
  { name: 'below-noon', cameraY: 480, phase: 0.5 },
] as const;

async function capture(page: Page, place: { x: number; z: number }, view: typeof VIEWS[number], puffs: boolean): Promise<Buffer> {
  const frame = await page.evaluate(({ place, view, puffs }) => {
    const api = window.__SOARING__;
    api.setTimeOfDay(view.phase);
    api.setPuffCloudsVisible(puffs);
    api.reviewFlight!({ x: place.x, z: place.z, heading: 0.4, y: view.cameraY - 178 * 0.31 / 3 });
    return api.snapshot().renderedFrames;
  }, { place, view, puffs });
  await page.waitForFunction((frame) => {
    const s = window.__SOARING__.snapshot();
    return s.pending === 0 && s.renderedFrames > frame;
  }, frame, { timeout: 300_000 });
  const captureFrame = await page.evaluate(() => {
    window.__SOARING__.setCapturePixelRatio(1);
    return window.__SOARING__.snapshot().renderedFrames;
  });
  await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame + 8, captureFrame, { timeout: 120_000 });
  const image = await page.screenshot({ path: `test-results/cloud-puff-deck/${view.name}-${puffs ? 'puffs' : 'no-puffs'}.png` });
  await page.evaluate(() => window.__SOARING__.setCapturePixelRatio(0.25));
  return image;
}

test('puffs never show through the cloud deck from above, and still show below it', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
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
    document.querySelector('#intro')?.classList.add('hidden');
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
  });
  await mkdir('test-results/cloud-puff-deck', { recursive: true });
  const results: Array<Record<string, unknown>> = [];
  for (const view of VIEWS) {
    const withPuffs = await capture(page, place, view, true);
    const state = await page.evaluate(() => ({
      layer: window.__SOARING__.snapshot().cloudLayer,
      placed: window.__SOARING__.puffCloudSnapshot().placements.filter((puff) => puff.opacity > 0.01).length,
    }));
    const withoutPuffs = await capture(page, place, view, false);
    await testInfo.attach(view.name, { body: withPuffs, contentType: 'image/png' });
    // Compare the real browser screenshots. Outside the chase eagle, whose wings keep
    // beating, every changed pixel is a visible puff.
    const diff = await page.evaluate(async ([a, b]) => {
      const read = async (data: string) => {
        const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
        const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const p = await read(a!), q = await read(b!);
      let changed = 0, largest = 0;
      for (let i = 0; i < p.length; i += 4) {
        const x = (i / 4) % 1440, y = Math.floor(i / 4 / 1440);
        if (x >= 560 && x < 880 && y >= 380 && y < 480) continue;
        const d = Math.max(Math.abs(p[i]! - q[i]!), Math.abs(p[i + 1]! - q[i + 1]!), Math.abs(p[i + 2]! - q[i + 2]!));
        if (d > 6) changed++;
        largest = Math.max(largest, d);
      }
      return { changed, largest };
    }, [withPuffs.toString('base64'), withoutPuffs.toString('base64')]);
    results.push({ ...view, ...state, ...diff });
  }
  await writeFile('test-results/cloud-puff-deck/puff-pixels.json', JSON.stringify({ seed: 448122, place, results }, null, 2));
  expect(errors).toEqual([]);
  const [aboveNoon, aboveNight, belowNoon] = results;
  expect(aboveNoon!.changed).toBe(0);
  expect(aboveNight!.changed).toBe(0);
  expect(belowNoon!.changed).toBeGreaterThan(200);
});

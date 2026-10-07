import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Failure modes: the skinned, alpha-cut material or its cloud-fog patch fails to compile and
// the bird vanishes; the feather atlas does not paint, so the alpha test cuts the whole bird
// away or leaves it white; a bad skin binding tears or collapses the wings; the bird grows
// past one draw call; the wider wings leave the screen box other captures exclude.
const SEED = '448122';
const OUT = 'test-results/eagle-model';
const CHASE_BOX = { x0: 560, x1: 880, y0: 380, y1: 480 }; // tests/cloud-puff-deck.smoke.ts

async function capture(page: Page, name: string, eagle: boolean): Promise<{ image: Buffer; drawCalls: number; pixelRatio: number }> {
  const frame = await page.evaluate((eagle) => {
    window.__SOARING__.setEagleVisible(eagle);
    return window.__SOARING__.snapshot().renderedFrames;
  }, eagle);
  await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame + 8, frame, { timeout: 120_000 });
  const { drawCalls, pixelRatio } = await page.evaluate(() => window.__SOARING__.snapshot());
  // At 0.25 the thin chase wings blend with blue sky; their mean is not feather colour.
  expect(pixelRatio, `${name} must use the fixed capture resolution`).toBe(1);
  return { image: await page.screenshot({ path: `${OUT}/${name}.png` }), drawCalls, pixelRatio };
}

/** Pixels that change when the eagle is hidden: count, bounds, and mean colour. */
function eaglePixels(page: Page, withEagle: Buffer, without: Buffer) {
  return page.evaluate(async ([a, b]) => {
    const read = async (data: string) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
      context.drawImage(image, 0, 0);
      return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width };
    };
    const p = await read(a!), q = await read(b!);
    let count = 0, red = 0, green = 0, blue = 0;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < p.data.length; i += 4) {
      const d = Math.max(Math.abs(p.data[i]! - q.data[i]!), Math.abs(p.data[i + 1]! - q.data[i + 1]!), Math.abs(p.data[i + 2]! - q.data[i + 2]!));
      if (d <= 24) continue;
      const x = (i / 4) % p.width, y = Math.floor(i / 4 / p.width);
      count += 1; red += p.data[i]!; green += p.data[i + 1]!; blue += p.data[i + 2]!;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { count, bounds: { x0, x1, y0, y1 }, mean: [red / count, green / count, blue / count] };
  }, [withEagle.toString('base64'), without.toString('base64')]);
}

test('the feathered eagle draws as one skinned call with painted, spread wings', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.addInitScript((seed) => {
    localStorage.setItem('soaring.world-seed.v1', seed);
    localStorage.setItem('soaring.scenic-visit.v1', '0');
  }, SEED);
  // Keep smoke streaming/flight hooks, but disable adaptive quality for the picture comparison.
  // Slow software GL otherwise resets the requested capture ratio to smoke's 0.25.
  await page.goto('/?smoke&profile');
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.evaluate(() => window.__SOARING__.advanceSimulation!(20));
  // Hold a glide at noon in the default chase view, with the overlays and clouds out of frame.
  const start = await page.evaluate(() => {
    const api = window.__SOARING__;
    const { position, heading } = api.snapshot();
    api.reviewFlight!({ x: position[0]!, y: position[1]!, z: position[2]!, heading });
    api.setTimeOfDay(0.42);
    api.setCloudCoverage(0);
    api.setPuffCloudsVisible(false);
    api.setCapturePixelRatio(1);
    document.querySelector('#intro')?.classList.add('hidden');
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
    document.querySelector<HTMLElement>('.minimap')!.style.visibility = 'hidden';
    return { position, heading };
  });
  await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0, undefined, { timeout: 240_000 });
  await mkdir(OUT, { recursive: true });

  const chase = await capture(page, 'chase', true);
  const chaseHidden = await capture(page, 'chase-hidden', false);
  const chasePixels = await eaglePixels(page, chase.image, chaseHidden.image);

  // A close three-quarter view from above shows the painted feather tracts.
  await page.evaluate(({ position, heading }) => {
    const [x, y, z] = position as [number, number, number];
    window.__SOARING__.setViewpoint({ x: x - Math.sin(heading) * 1.3 + Math.cos(heading) * 1.1, y: y + 0.84,
      z: z - Math.cos(heading) * 1.3 - Math.sin(heading) * 1.1, lookX: x, lookY: y, lookZ: z });
  }, start);
  const close = await capture(page, 'close', true);
  const closeHidden = await capture(page, 'close-hidden', false);
  const closePixels = await eaglePixels(page, close.image, closeHidden.image);

  const evidence = {
    seed: Number(SEED), start,
    eagleDrawCalls: chase.drawCalls - chaseHidden.drawCalls,
    capturePixelRatios: [chase, chaseHidden, close, closeHidden].map((capture) => capture.pixelRatio),
    chase: chasePixels, close: closePixels,
  };
  await writeFile(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));

  expect(errors).toEqual([]);
  expect(evidence.eagleDrawCalls).toBe(1);
  // From behind, the spread wings make a wide, flat silhouette inside the box other captures skip.
  const { bounds } = chasePixels;
  expect(chasePixels.count).toBeGreaterThan(250);
  expect((bounds.x1 - bounds.x0) / (bounds.y1 - bounds.y0)).toBeGreaterThan(3);
  expect(bounds.x0).toBeGreaterThanOrEqual(CHASE_BOX.x0);
  expect(bounds.x1).toBeLessThan(CHASE_BOX.x1);
  expect(bounds.y0).toBeGreaterThanOrEqual(CHASE_BOX.y0);
  expect(bounds.y1).toBeLessThan(CHASE_BOX.y1);
  // Painted feathers are brown, not the white of an unpainted atlas.
  for (const pixels of [chasePixels, closePixels]) {
    const [red, green, blue] = pixels.mean as [number, number, number];
    expect(red).toBeGreaterThan(blue);
    expect((red + green + blue) / 3).toBeLessThan(140);
  }
  expect(closePixels.count).toBeGreaterThan(chasePixels.count * 4);
});

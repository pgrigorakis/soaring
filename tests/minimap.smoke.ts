import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Failure modes: the trail does not record flight time or loses days on reload; a reload joins
// the old and new path with a straight line; the minimap stays blank, loses the trail, or blocks
// frames; zoom shows nothing while the new raster paints; M opens the map while typing; the
// export is half painted, the wrong size, or badly named; biomes drift back to small mixed specks.
const SEED = 80231;
const DAY_SECONDS = 900;
const evidence = 'test-results/minimap';

type StoredTrail = { seed: number; clock: number; points: number[] };

async function storedTrail(page: Page): Promise<StoredTrail> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('soaring.trail.v1')!) as StoredTrail);
}

/** Lets frames run after a jump or zoom, then waits until the minimap raster covers the whole square. */
async function minimapSettled(page: Page): Promise<void> {
  const frame = await page.evaluate(() => window.__SOARING__.snapshot().renderedFrames);
  await page.waitForFunction((start) => window.__SOARING__.snapshot().renderedFrames > start + 2, frame);
  await expect(page.locator('.minimap')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
}

/** Pixel counts of the drawn minimap: trail gold, land (not the empty background), and distinct colours. */
async function minimapPixels(page: Page): Promise<{ trail: number; land: number; colours: number }> {
  return page.locator('.minimap').evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let trail = 0, land = 0;
    const colours = new Set<number>();
    for (let index = 0; index < data.length; index += 4) {
      const [r, g, b] = [data[index]!, data[index + 1]!, data[index + 2]!];
      if (r > 235 && g > 180 && r - b > 50) trail += 1;
      if (Math.abs(r - 0x4c) + Math.abs(g - 0x6a) + Math.abs(b - 0x5c) > 12) land += 1;
      colours.add((r >> 3) << 10 | (g >> 3) << 5 | b >> 3);
    }
    return { trail, land: land / (data.length / 4), colours: colours.size };
  });
}

test('minimap shows four days of trail, survives a reload, and exports the biome map', async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((seed) => localStorage.setItem('soaring.world-seed.v1', String(seed)), SEED);
  await page.goto('/?smoke');
  const minimap = page.locator('.minimap');
  await expect(minimap).toBeVisible();
  await minimapSettled(page);
  const box = (await minimap.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect({ right: viewport.width - box.x - box.width, bottom: viewport.height - box.y - box.height, size: box.width })
    .toEqual({ right: 18, bottom: 18, size: 184 });

  // Fly four days (4 × 15 minutes of flight) through the real navigator, five minutes per call.
  for (let call = 0; call < 12; call += 1) await page.evaluate(() => window.__SOARING__.advanceSimulation!(300));
  await page.evaluate(() => window.__SOARING__.advanceSimulation!(20));
  const flown = await storedTrail(page);
  expect(flown.seed).toBe(SEED);
  const times = flown.points.filter((_, index) => index % 4 === 2);
  expect(flown.clock).toBeGreaterThanOrEqual(4 * DAY_SECONDS);
  // Older points fall off: the kept span is four days, not the whole flight.
  expect(flown.clock - times[0]!).toBeLessThanOrEqual(4 * DAY_SECONDS + 1);
  expect(flown.clock - times[0]!).toBeGreaterThan(4 * DAY_SECONDS - 10);
  expect(times.length).toBeGreaterThan(850);

  await minimapSettled(page);
  const near = await minimapPixels(page);
  await minimap.screenshot({ path: `${evidence}/minimap-6km.png` });
  expect(near.land).toBeGreaterThan(0.9);
  expect(near.trail).toBeGreaterThan(40);
  expect(near.colours).toBeGreaterThan(60);

  // Zoom steps 6 → 20 → 70 km, and the new raster still shows land and the trail.
  await minimap.click();
  await expect(minimap).toHaveAttribute('data-zoom', '20000');
  await minimap.click();
  await expect(minimap).toHaveAttribute('data-zoom', '70000');
  await minimapSettled(page);
  const far = await minimapPixels(page);
  await minimap.screenshot({ path: `${evidence}/minimap-70km.png` });
  expect(far.land).toBeGreaterThan(0.9);
  expect(far.trail).toBeGreaterThan(40);

  // A reload keeps the trail; the first point after it starts a new line, not a jump.
  await page.reload();
  await minimapSettled(page);
  await page.evaluate(() => window.__SOARING__.advanceSimulation!(30));
  const reloaded = await storedTrail(page);
  expect(reloaded.clock).toBeGreaterThan(flown.clock);
  const gaps = reloaded.points.flatMap((value, index) => (index % 4 === 3 && value === 1 ? [index / 4 - 0.75] : []));
  expect(gaps.length).toBe(2);
  // The count can stay level: new points push points older than four days out. So count new points,
  // which start at the second gap. The trail saves every 20 s, so 30 s of flight store about five.
  const fresh = reloaded.points.filter((value, index) => index % 4 === 2 && value > flown.clock).length;
  expect(fresh).toBeGreaterThanOrEqual(4);
  expect(reloaded.points[gaps[1]! * 4 + 2]).toBeGreaterThan(flown.clock);

  // M does nothing while typing in a settings field, and opens the biome map otherwise.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'typing-probe';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('m');
  await expect(page.locator('.map-panel')).toBeHidden();
  await page.evaluate(() => document.querySelector('#typing-probe')!.remove());
  await page.keyboard.press('m');
  const panel = page.locator('.map-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await panel.locator('.map-card').screenshot({ path: `${evidence}/biome-map-panel.png` });
  const downloading = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export PNG' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`soaring-biomes-${SEED}-trail.png`);
  const exported = `${evidence}/${download.suggestedFilename()}`;
  await download.saveAs(exported);
  const png = await readFile(exported);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 1200]);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // Biome patches stay broad: dominant-biome changes per 10 km of land along fixed lines.
  // Before plate cooling and the 7 km land field this seed measured 2.51; afterwards 1.70.
  const mixing = await page.evaluate(async (seed) => {
    const worldPath = '/src/world.ts';
    const { WorldModel } = await import(worldPath);
    const world = new WorldModel(seed);
    let changes = 0, metres = 0;
    for (let line = 0; line < 24; line += 1) {
      const angle = line * 2.39996, ox = Math.sin(line * 7.1) * 30000, oz = Math.cos(line * 3.3) * 30000;
      let previous: string | null = null;
      for (let step = 0; step <= 200; step += 1) {
        const sample = world.sample(ox + Math.cos(angle) * step * 100, oz + Math.sin(angle) * step * 100);
        if (sample.water) { previous = null; continue; }
        const dominant = Object.entries(sample.biome as Record<string, number>).sort((a, b) => b[1] - a[1])[0]![0];
        if (previous !== null) { metres += 100; if (dominant !== previous) changes += 1; }
        previous = dominant;
      }
    }
    return (changes / metres) * 10000;
  }, SEED);
  expect(mixing).toBeLessThan(2);

  await writeFile(`${evidence}/minimap.json`, JSON.stringify({ seed: SEED, trailPoints: reloaded.points.length / 4,
    clock: reloaded.clock, gaps, near, far, biomeChangesPer10km: mixing }, null, 2));
  expect(errors).toEqual([]);
});

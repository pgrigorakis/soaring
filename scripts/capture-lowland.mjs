// Captures the #86 lowland vantages with the default chase camera at noon.
// Repeatable artifact: node scripts/capture-lowland.mjs <origin> <output-dir>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.argv[2] ?? 'http://127.0.0.1:4173';
const output = process.argv[3] ?? 'test-results/lowland-vantages';
const seed = 5;
// Seed 5 points whose next 2 km ahead (+z) is at least 95% one biome.
const vantages = [
  { name: 'hills', x: 28000, z: 0, heading: 0 },
  { name: 'woodland', x: -7800, z: -7800, heading: 0 },
  { name: 'moor', x: -6900, z: 4000, heading: 0 },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.addInitScript((value) => localStorage.setItem('soaring.world-seed.v1', String(value)), seed);
await page.goto(origin);
await page.waitForFunction(() => window.__SOARING__?.reviewFlight !== undefined, undefined, { timeout: 60_000 });
await page.evaluate(() => { document.querySelector('#intro')?.classList.add('hidden'); document.body.classList.add('cursor-hidden'); });
const record = { seed, origin, vantages: {} };
for (const vantage of vantages) {
  await page.evaluate(({ x, z, heading }) => {
    window.__SOARING__.reviewFlight({ x, z, heading });
    window.__SOARING__.setTimeOfDay(0.5);
  }, vantage);
  // Clearing the terrain leaves pending at zero for a frame, so also wait for the fog to
  // reach the requested visibility, and require it to hold for 60 rendered frames.
  const loaded = () => { const state = window.__SOARING__.snapshot();
    return state.pending === 0 && state.visibleDistance >= state.requestedDistance * 0.95; };
  for (let attempt = 0; ; attempt += 1) {
    await page.waitForFunction(loaded, undefined, { timeout: 300_000 });
    const settled = await page.evaluate(() => window.__SOARING__.snapshot().renderedFrames);
    await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames >= frame + 60, settled, { timeout: 120_000 });
    if (await page.evaluate(loaded)) break;
    if (attempt === 10) throw new Error(`${vantage.name} did not hold full visibility`);
  }
  await page.locator('canvas').screenshot({ path: `${output}/${vantage.name}.png` });
  const state = await page.evaluate(() => window.__SOARING__.snapshot());
  record.vantages[vantage.name] = { ...vantage, position: state.position, chunks: state.chunks };
  console.log(vantage.name, JSON.stringify({ position: state.position, visible: state.visibleDistance, requested: state.requestedDistance, quality: state.qualityStep, pixelRatio: state.pixelRatio, lowPower: state.lowPower }));
}
await writeFile(`${output}/vantages.json`, JSON.stringify(record, null, 2));
await browser.close();

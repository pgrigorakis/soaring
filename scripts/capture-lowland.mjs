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
  await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0, undefined, { timeout: 180_000 });
  const settled = await page.evaluate(() => window.__SOARING__.snapshot().renderedFrames);
  await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames >= frame + 60, settled, { timeout: 120_000 });
  await page.locator('canvas').screenshot({ path: `${output}/${vantage.name}.png` });
  const state = await page.evaluate(() => window.__SOARING__.snapshot());
  record.vantages[vantage.name] = { ...vantage, position: state.position, chunks: state.chunks };
  console.log(vantage.name, state.position);
}
await writeFile(`${output}/vantages.json`, JSON.stringify(record, null, 2));
await browser.close();

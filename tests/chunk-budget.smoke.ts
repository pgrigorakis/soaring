import { expect, test } from '@playwright/test';

test('resumable streaming cancels safely and reuses detached buffers', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '12345');
    localStorage.setItem('soaring.settings.v1', JSON.stringify({ terrainVisibility: 720, lowPower: true }));
  });
  await page.goto('/?smoke');
  await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0);
  const records = [];
  for (const x of [720, 1440, -720]) {
    await page.evaluate((x) => window.__SOARING__.reviewFlight!({ x, z: 0, heading: 0 }), x);
    // Change center again before the current build completes, exercising cancellation.
    await page.waitForTimeout(40);
    const frame = await page.evaluate((x) => {
      window.__SOARING__.reviewFlight!({ x: x + 360, z: 0, heading: 0 });
      return window.__SOARING__.snapshot().renderedFrames;
    }, x);
    await page.waitForFunction((frame) => {
      const s = window.__SOARING__.snapshot();
      return s.renderedFrames > frame && s.pending === 0 && s.visibleDistance === 720;
    }, frame);
    const s = await page.evaluate(() => window.__SOARING__.snapshot());
    expect(s.visibleDistance).toBe(720);
    expect(s.chunks).toBeLessThanOrEqual(49);
    expect(s.geometries).toBeLessThan(220);
    expect(s.chunkBuildBudget).toBe(records.length === 0 ? 2 : 4);
    records.push(s);
    if (records.length === 1) {
      await page.locator('#low-power').evaluate((input: HTMLInputElement) => input.click());
    }
  }
  const last = records.at(-1)!;
  expect(last.buildTiming.reused).toBeGreaterThan(0);
  expect(last.buildTiming.maxSliceMs).toBeLessThan(50);
  await info.attach('streaming-reuse', { body: JSON.stringify(records, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('streaming-complete.png') });
});

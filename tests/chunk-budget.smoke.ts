import { expect, test } from '@playwright/test';

// Failure mode: recenter cancels a partially built chunk even when its key/detail remain needed.
test('retains valid partial terrain work across a center change', async ({ page }, info) => {
  await page.goto('/?smoke');
  const evidence = await page.evaluate(async () => {
    const terrainPath = '/src/terrain.ts';
    const worldPath = '/src/world.ts';
    const threePath = '/node_modules/.vite/deps/three.js';
    const { TerrainStream } = await import(terrainPath);
    const { WorldModel } = await import(worldPath);
    const THREE = await import(threePath);
    const stream = new TerrainStream(new THREE.Scene(), new WorldModel(12345));
    stream.update(10, 10, .001);
    stream.update(10, 10, .1);
    const active = stream.active;
    const before = stream.buildTiming;
    stream.update(370, 10, .001);
    const retained = active !== null && stream.active === active;
    const pending = stream.pendingCount;
    stream.dispose();
    return { retained, pending, before };
  });
  await info.attach('retained-work', { body: JSON.stringify(evidence), contentType: 'application/json' });
  expect(evidence.retained).toBe(true);
  expect(evidence.pending).toBeGreaterThan(0);
});

test('resumable streaming cancels safely and reuses detached buffers', async ({ page }, info) => {
  test.setTimeout(480_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '12345');
  });
  await page.goto('/?smoke');
  // Coverage is measured at fixed poses. A slow CI CPU can otherwise add work faster than 4 ms builds drain it.
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
    }, frame, { timeout: 180_000 });
    const s = await page.evaluate(() => window.__SOARING__.snapshot());
    expect(s.visibleDistance).toBe(720);
    expect(s.chunks).toBeLessThanOrEqual(49);
    expect(s.geometries).toBeLessThan(220);
    expect(s.chunkBuildBudget).toBe(4);
    records.push(s);
  }
  const last = records.at(-1)!;
  expect(last.buildTiming.reused).toBeGreaterThan(0);
  expect(last.buildTiming.maxSliceMs).toBeLessThan(50);
  await info.attach('streaming-reuse', { body: JSON.stringify(records, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('streaming-complete.png') });
});

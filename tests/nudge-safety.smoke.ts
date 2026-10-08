import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('vertical hints keep recovery and the ceiling in charge', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '448122');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
  });
  await page.goto('/?smoke');
  await expect(page.locator('canvas').first()).toBeVisible();
  const evidence = await page.evaluate(async () => {
    const modulePath = '/src/world.ts';
    const { WorldModel } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/world');
    const world = new WorldModel(448122);
    const app = window.__SOARING__;
    const runs = [];
    for (const key of ['ArrowDown', 'ArrowUp']) {
      window.dispatchEvent(new Event('blur'));
      app.reviewFlight!({ x: 0, z: 0, heading: 0 });
      const initial = app.snapshot();
      const ground = initial.position[1]! - initial.cycle.cruise;
      const y = key === 'ArrowUp' ? ground + 800 : initial.position[1]! - 1;
      app.reviewFlight!({ x: 0, y, z: 0, heading: 0 });
      app.reviewFlight!(null);
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      const trace = [];
      for (let i = 0; i < 240; i++) {
        app.advanceSimulation!(1 / 120);
        const s = app.snapshot();
        const local = world.sample(s.position[0]!, s.position[2]!);
        trace.push({ y: s.position[1]!, clearance: s.position[1]! - (local.water ? local.surface : local.height),
          flapping: s.flapping, pitch: s.pitch });
      }
      window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      runs.push({ key, y, trace });
    }
    return { seed: world.seed, runs };
  });
  const path = testInfo.outputPath('vertical-safety.json');
  await writeFile(path, JSON.stringify(evidence, null, 2));
  await testInfo.attach('vertical-safety', { path, contentType: 'application/json' });
  const recovery = evidence.runs[0]!;
  expect(recovery.trace[0]!.y).toBeGreaterThan(recovery.y);
  expect(recovery.trace.at(-1)!.y).toBeGreaterThan(recovery.y + 2);
  const ceiling = evidence.runs[1]!;
  expect(Math.max(...ceiling.trace.map(s => s.clearance))).toBeLessThanOrEqual(800.1);
  // The ceiling rises with this fixture's ground. It must not cause repeated bounces.
  expect(Math.min(...ceiling.trace.map(s => s.clearance))).toBeGreaterThan(799.4);
  const directions = ceiling.trace.slice(1).map((s, i) => Math.sign(s.clearance - ceiling.trace[i]!.clearance));
  const reversals = directions.slice(1).filter((direction, i) => direction !== directions[i]);
  expect(reversals.length).toBeLessThanOrEqual(1);
});

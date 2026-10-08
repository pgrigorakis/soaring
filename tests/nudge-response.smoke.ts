import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Run synchronously so rendering speed and animation frames cannot change key timing.
// This uses the real key listeners, navigator and rendered bird, not a model of them.
export function measureVerticalResponse() {
  const app = window.__SOARING__;
  const dt = 1 / 120;
  const results = [];
  for (const scenario of ['ArrowUp', 'ArrowDown', 'ArrowDownDuringFlap']) {
    const key = scenario === 'ArrowUp' ? 'ArrowUp' : 'ArrowDown';
    window.dispatchEvent(new Event('blur'));
    app.reviewFlight!({ x: 0, z: 0, heading: 0 });
    const initial = app.snapshot();
    const ground = initial.position[1]! - initial.cycle.cruise;
    app.reviewFlight!({ x: 0, y: ground + 250, z: 0, heading: 0 });
    app.reviewFlight!(null);
    let previous = app.snapshot();
    const step = () => {
      app.advanceSimulation!(dt);
      const current = app.snapshot();
      const sample = { rate: (current.position[1]! - previous.position[1]!) / dt,
        pitch: current.pitch, flapping: current.flapping, behavior: current.behavior };
      previous = current;
      return sample;
    };
    let before = step();
    for (let i = 1; i < 960; i++) before = step();
    if (scenario === 'ArrowDownDuringFlap') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      for (let i = 0; i < 24; i++) before = step();
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
    }
    const trace = [];
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    for (let i = 0; i < 360; i++) trace.push({ seconds: (i + 1) * dt, ...step() });
    window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    // The last half-second of a three-second hold defines the settled target.
    const target = trace.slice(-60).reduce((a, s) => ({ rate: a.rate + s.rate / 60,
      pitch: a.pitch + s.pitch / 60 }), { rate: 0, pitch: 0 });
    const times: Record<string, number | null> = {};
    for (const metric of ['rate', 'pitch'] as const) {
      for (const fraction of [0.5, 0.9]) {
        times[metric + fraction] = trace.find(s =>
          (s[metric] - before[metric]) / (target[metric] - before[metric]) >= fraction)?.seconds ?? null;
      }
    }
    const release = [];
    for (let i = 0; i < 180; i++) release.push({ seconds: (i + 1) * dt, ...step() });
    results.push({ scenario, key, before, target, times, trace, release });
  }
  return { seed: app.snapshot().seed, dt, start: { x: 0, z: 0, clearance: 250, heading: 0 }, warmup: 8, results };
}

test('vertical nudges respond promptly and ease back without a flap-burst delay', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '448122');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
  });
  await page.goto('/?smoke');
  await expect(page.locator('canvas').first()).toBeVisible();
  const evidence = await page.evaluate(measureVerticalResponse);
  const path = testInfo.outputPath('vertical-response.json');
  await writeFile(path, JSON.stringify(evidence, null, 2));
  await testInfo.attach('vertical-response', { path, contentType: 'application/json' });
  for (const result of evidence.results) {
    expect(result.target.rate).toBeCloseTo(result.key === 'ArrowUp' ? 4 : -5, 1);
    for (const [metric, limit] of Object.entries({ 'rate0.5': 0.12, 'rate0.9': 0.25,
      'pitch0.5': 0.2, 'pitch0.9': 0.4 })) {
      expect(result.times[metric], `${result.scenario} ${metric}`).not.toBeNull();
      expect(result.times[metric]!, `${result.scenario} ${metric}`).toBeLessThanOrEqual(limit);
    }
    expect(result.release.at(-1)!.rate).toBeCloseTo(-1, 1);
    const samples = [result.trace.at(-1)!, ...result.release];
    for (let i = 1; i < samples.length; i++) {
      expect(Math.abs(samples[i]!.rate - samples[i - 1]!.rate)).toBeLessThan(0.4);
      expect(Math.abs(samples[i]!.pitch - samples[i - 1]!.pitch)).toBeLessThan(0.012);
    }
  }
});

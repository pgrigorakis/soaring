import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const ARTIFACT_DIR = 'test-results/issue-97';
const PHASES = [
  { name: 'noon', phase: 0.5 },
  { name: 'golden-hour', phase: 0.72 },
  { name: 'night', phase: 0 },
] as const;

test('samples horizon fog asynchronously at fixed sky phases', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '5');
    const reads = { synchronous: 0, asynchronous: 0 };
    const unhandled: string[] = [];
    Object.assign(window, { __issue97Reads: reads, __issue97Unhandled: unhandled });
    addEventListener('unhandledrejection', (event) => unhandled.push(String(event.reason)));

    const prototype = WebGL2RenderingContext.prototype as unknown as { readPixels: (this: WebGL2RenderingContext, ...args: unknown[]) => void };
    const original = prototype.readPixels;
    prototype.readPixels = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      const destination = args.at(-1);
      if (ArrayBuffer.isView(destination)) reads.synchronous += 1;
      else if (destination === 0) reads.asynchronous += 1;
      return original.apply(this, args);
    };
  });

  await page.goto('/?smoke');
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('#intro')?.classList.add('hidden');
    const toggle = document.querySelector<HTMLElement>('#settings-toggle');
    if (toggle) toggle.style.visibility = 'hidden';
    window.__SOARING__.reviewFlight?.({ x: 0, z: 0, heading: 0 });
    window.__SOARING__.setVisibility(2400);
    window.__SOARING__.setCaptureClear(false);
    window.__SOARING__.lookAtBody('horizon');
  });
  const initialFog = await page.evaluate(() => window.__SOARING__.snapshot().fog);
  expect(initialFog.color.every(Number.isFinite)).toBe(true);
  await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0, undefined, { timeout: 60_000 });

  await mkdir(ARTIFACT_DIR, { recursive: true });
  const phaseRecords: Array<Record<string, unknown>> = [];
  for (const { name, phase } of PHASES) {
    const frame = await page.evaluate((value) => {
      window.__SOARING__.setTimeOfDay(value);
      return window.__SOARING__.snapshot().renderedFrames;
    }, phase);
    await page.waitForFunction((previous) => window.__SOARING__!.snapshot().renderedFrames > previous, frame);
    await page.waitForTimeout(900);
    const screenshot = await page.screenshot({ path: `${ARTIFACT_DIR}/${name}.png` });
    await testInfo.attach(`issue-97-${name}`, { body: screenshot, contentType: 'image/png' });
    phaseRecords.push(await page.evaluate((label) => {
      const state = window.__SOARING__.snapshot() as ReturnType<typeof window.__SOARING__.snapshot> & {
        fog?: { color: number[]; targetColor: number[]; readPending: boolean; samples: number; failures: number };
      };
      return { label, state: { phase: state.timeOfDay, sunElevation: state.sunElevation, visibleDistance: state.visibleDistance, fog: state.fog ?? null } };
    }, name));
  }

  const rapidChange = await page.evaluate(async () => {
    const app = window.__SOARING__;
    app.setTimeOfDay(0.5);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const inFlight = app.snapshot().fog.readPending;
    const samplesBeforeChange = app.snapshot().fog.samples;
    app.setTimeOfDay(0.72);
    app.setTimeOfDay(0);
    return { renderedFrames: app.snapshot().renderedFrames, inFlight, samplesBeforeChange };
  });
  await page.waitForFunction((previous) => window.__SOARING__!.snapshot().renderedFrames > previous.renderedFrames, rapidChange);
  await page.waitForFunction((samples) => {
    const fog = window.__SOARING__!.snapshot().fog;
    return fog.samples > samples && !fog.readPending;
  }, rapidChange.samplesBeforeChange);
  await page.waitForTimeout(900);

  const timing = await page.evaluate(async () => {
    const gaps: number[] = [];
    let previous = performance.now();
    for (let index = 0; index < 180; index += 1) {
      const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      gaps.push(now - previous);
      previous = now;
    }
    const sorted = [...gaps].sort((a, b) => a - b);
    return {
      measuredAnimationFrames: gaps.length,
      frameGapMs: {
        mean: gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length,
        median: sorted[Math.floor(sorted.length * 0.5)]!,
        p95: sorted[Math.floor(sorted.length * 0.95)]!,
        max: sorted.at(-1)!,
      },
    };
  });
  const result = await page.evaluate(({ phaseRecords, timing, rapidChange }) => {
    const globals = window as Window & { __issue97Reads?: { synchronous: number; asynchronous: number }; __issue97Unhandled?: string[] };
    const snapshot = window.__SOARING__.snapshot();
    return {
      environment: { seed: snapshot.seed, viewport: [innerWidth, innerHeight], pixelRatio: snapshot.pixelRatio, renderer: document.querySelector('canvas')?.getContext('webgl2')?.getParameter(7938) },
      phases: phaseRecords,
      rapidChangeFinalPhase: snapshot.timeOfDay,
      rapidChangeHadReadInFlight: rapidChange.inFlight,
      rapidFog: snapshot.fog,
      reads: globals.__issue97Reads,
      unhandledRejections: globals.__issue97Unhandled,
      timing,
      finalSnapshot: snapshot,
    };
  }, { phaseRecords, timing, rapidChange });
  await writeFile(`${ARTIFACT_DIR}/run.json`, JSON.stringify(result, null, 2));
  await testInfo.attach('issue-97-run', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });

  expect(result.reads?.synchronous).toBe(0);
  expect(result.reads?.asynchronous).toBeGreaterThan(0);
  expect(result.unhandledRejections).toEqual([]);
  expect(errors).toEqual([]);
  expect(result.rapidChangeFinalPhase).toBe(0);
  expect(result.rapidChangeHadReadInFlight).toBe(true);
  for (const phase of result.phases) {
    const state = phase.state as { visibleDistance: number; fog: { color: number[]; targetColor: number[]; readPending: boolean; samples: number; failures: number } | null };
    expect(state.visibleDistance).toBe(2400);
    expect(state.fog).not.toBeNull();
    expect(state.fog?.readPending).toBe(false);
    expect(state.fog?.samples).toBeGreaterThan(0);
    expect(state.fog?.failures).toBe(0);
    expect(Math.hypot(...state.fog!.color.map((value, index) => value - state.fog!.targetColor[index]!))).toBeLessThan(0.06);
  }
  const targetColors = result.phases.map((phase) => (phase.state as { fog: { targetColor: number[] } }).fog.targetColor);
  const colorDistance = (left: number[], right: number[]) => Math.hypot(...left.map((value, index) => value - right[index]!));
  expect(colorDistance(targetColors[0]!, targetColors[1]!)).toBeGreaterThan(0.1);
  expect(colorDistance(targetColors[1]!, targetColors[2]!)).toBeGreaterThan(0.1);
  expect(colorDistance(result.rapidFog.targetColor, targetColors[2]!)).toBeLessThan(0.02);
  expect(colorDistance(result.rapidFog.color, result.rapidFog.targetColor)).toBeLessThan(0.06);
});

declare global {
  interface Window {
    __issue97Reads?: { synchronous: number; asynchronous: number };
    __issue97Unhandled?: string[];
  }
}

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { runBenchRound, VANTAGES, type RoundResult } from '../scripts/perf-bench';

// Failure modes this test guards (inventoried before the implementation):
//  1. Vantage counts drift between runs of one build (draw calls, triangles, chunks).
//  2. A measurement starts while terrain is pending, so early frames show a partial scene.
//  3. A dynamic input (sky phase, quality step, frame cap, camera follow) moves during a hold.
//  4. EXT_disjoint_timer_query_webgl2 is missing: GPU time must read "unavailable", never 0.
//  5. The GPU reports a disjoint event: those results must be discarded, not averaged.
//  6. Timer queries leak: every created query must be deleted after the recording ends.
//  7. The profile hook or timer query ships in production, or arms without `?profile`.
//  8. "Busy time" labels mix latency (frame interval) with active work (callback time).
const ARTIFACT_DIR = 'test-results/perf-bench-smoke';
const TIMER_EXTENSION = 'EXT_disjoint_timer_query_webgl2';
const OPTIONS = { url: '', smoke: true, frames: 12, warmupFrames: 4, seed: 5 };

test.describe.configure({ mode: 'serial' });

test('two runs of one build report identical draw calls and triangles at five held vantages', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const options = { ...OPTIONS, url: baseURL! };
  const first = await runBenchRound(browser, options);
  const second = await runBenchRound(browser, options);
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const artifact = { command: 'npm run test:smoke -- tests/perf-bench.smoke.ts', runs: [first, second] };
  await writeFile(`${ARTIFACT_DIR}/repeatability.json`, JSON.stringify(artifact, null, 2));
  await testInfo.attach('repeatability', { body: JSON.stringify(artifact, null, 2), contentType: 'application/json' });

  expect(first.vantages).toHaveLength(5);
  expect(first.vantages.map((vantage) => vantage.name)).toEqual(VANTAGES.map((vantage) => vantage.name));
  for (const [index, vantage] of first.vantages.entries()) {
    const other = second.vantages[index]!;
    expect(vantage.rendered, vantage.name).toBeGreaterThanOrEqual(OPTIONS.frames);
    expect(vantage.counts.calls, vantage.name).toBeGreaterThan(0);
    expect(vantage.counts.triangles, vantage.name).toBeGreaterThan(0);
    expect(vantage.counts.constant, `${vantage.name} counts vary inside a run`).toBe(true);
    expect(other.counts, `${vantage.name} counts differ between runs`).toEqual(vantage.counts);
    expect(other.held.chunks, vantage.name).toBe(vantage.held.chunks);
    // Terrain finished, sky phase held, quality and frame cap untouched.
    expect(vantage.held.pendingAtStart).toBe(0);
    expect(vantage.held.pendingAtEnd).toBe(0);
    expect(vantage.held.chunksAtEnd).toBe(vantage.held.chunks);
    expect(vantage.held.timeOfDay).toBeCloseTo(vantage.parameters.timeOfDay, 6);
    expect(vantage.held.qualityStep).toBe(0);
    expect(vantage.held.frameCap).toBeNull();
    expect(vantage.held.position).toEqual(other.held.position);
    // Latency and active work stay separate fields with their own definitions.
    expect(vantage.frameIntervalMs.p50).toBeGreaterThan(0);
    expect(vantage.mainThreadWorkMs.p50).toBeGreaterThan(0);
    expect(vantage.mainThreadWorkMs.p50).toBeLessThan(vantage.frameIntervalMs.max);
    expect(vantage.mainThreadBusyShare).toBeGreaterThan(0);
    expect(vantage.mainThreadBusyShare).toBeLessThanOrEqual(1);
  }
  // Environment metadata is recorded with the result.
  expect(first.environment.viewport).toEqual([1440, 900]);
  expect(first.environment.pixelRatio).toBeGreaterThan(0);
  expect(first.environment.glRenderer).toBeTruthy();
  expect(first.environment.browser).toBeTruthy();
  expect(first.environment.machine.cpu).toBeTruthy();
  expect(first.build.commit).toMatch(/^[0-9a-f]{40}$/);
  assertGpuLabelling(first);
  assertGpuLabelling(second);
  for (const run of [first, second]) expect(run.leakedQueries).toBe(0);
});

function assertGpuLabelling(run: RoundResult): void {
  for (const vantage of run.vantages) {
    if (run.gpu.status === 'unavailable') {
      expect(vantage.gpuMs, 'unavailable GPU timing is null, not zero').toBeNull();
      expect(run.gpu.reason).toBeTruthy();
    } else {
      expect(vantage.gpuMs).not.toBeNull();
      expect(vantage.gpuMs!.samples).toBeGreaterThan(0);
      expect(vantage.gpuMs!.p50).toBeGreaterThan(0);
    }
  }
}

test('reports GPU timing as unavailable when the timer extension is missing', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const run = await runBenchRound(browser, {
    ...OPTIONS, url: baseURL!, frames: 4, warmupFrames: 2, vantageLimit: 1,
    initScript: `const original = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function (name) { return name === '${TIMER_EXTENSION}' ? null : original.call(this, name); };`,
  });
  expect(run.gpu.status).toBe('unavailable');
  expect(run.gpu.reason).toContain('extension');
  expect(run.vantages[0]!.gpuMs).toBeNull();
  expect(run.leakedQueries).toBe(0);
});

test('discards GPU timings that follow a disjoint event and deletes every query', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const supported = await browser.newPage().then(async (page) => {
    const has = await page.evaluate((name) => !!document.createElement('canvas').getContext('webgl2')?.getExtension(name), TIMER_EXTENSION);
    await page.close();
    return has;
  });
  test.skip(!supported, 'This browser has no timer query extension, so the disjoint path cannot run.');
  const run = await runBenchRound(browser, {
    ...OPTIONS, url: baseURL!, frames: 6, warmupFrames: 2, vantageLimit: 1,
    // GPU_DISJOINT_EXT = 0x8FBB: report a disjoint GPU on every check.
    initScript: `const original = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (name) { return name === 0x8FBB ? true : original.call(this, name); };`,
  });
  expect(run.gpu.discardedDisjoint).toBeGreaterThan(0);
  expect(run.vantages[0]!.gpuMs).toBeNull();
  expect(run.gpu.status).toBe('unavailable');
  expect(run.gpu.reason).toContain('disjoint');
  expect(run.leakedQueries).toBe(0);
});

test('keeps profiling dev-only: no timer query without ?profile and none in the production bundle', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript((name) => {
    const requested: string[] = [];
    Object.assign(window, { __extensionRequests: requested });
    const prototype = WebGL2RenderingContext.prototype as unknown as { getExtension: (this: WebGL2RenderingContext, name: string) => unknown };
    const original = prototype.getExtension;
    prototype.getExtension = function (this: WebGL2RenderingContext, requestedName: string) {
      if (requestedName === name) requested.push(requestedName);
      return original.call(this, requestedName);
    };
  }, TIMER_EXTENSION);
  await page.goto('/?smoke');
  await page.waitForFunction(() => window.__SOARING__?.snapshot().renderedFrames > 2);
  const plain = await page.evaluate(() => ({
    requests: (window as unknown as { __extensionRequests: string[] }).__extensionRequests.length,
    hook: 'profile' in window.__SOARING__,
  }));
  expect(plain).toEqual({ requests: 0, hook: false });

  await page.goto('/?smoke&profile');
  await page.waitForFunction(() => window.__SOARING__?.snapshot().renderedFrames > 2);
  expect(await page.evaluate(() => 'profile' in window.__SOARING__)).toBe(true);

  const outDir = await mkdtemp(join(tmpdir(), 'soaring-prod-'));
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], { stdio: 'pipe' });
  const assets = join(outDir, 'assets');
  const bundle = (await Promise.all((await readdir(assets)).filter((name) => name.endsWith('.js')).map((name) => readFile(join(assets, name), 'utf8')))).join('\n');
  expect(bundle).not.toContain(TIMER_EXTENSION);
  expect(bundle).not.toContain('disjoint');
});

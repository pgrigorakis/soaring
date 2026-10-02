// Held-vantage performance bench. Drives the dev-only `?profile` hook with the existing
// reviewFlight, setTimeOfDay, setVisibility and setViewpoint controls. Run it with `npm run bench`.
// A held view measures steady render cost. It is not a sustained-flight hitch measurement:
// terrain streaming, flight updates and camera motion are deliberately absent.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import type { Browser } from '@playwright/test';

export interface Vantage {
  name: string;
  spot: 'lake' | 'confluence' | 'run' | 'network' | 'origin';
  heading: number | 'spot';
  timeOfDay: number;
}

/** Five fixed views: water at noon, a river junction, a long run at golden hour, a wide network, open land at night. */
export const VANTAGES: readonly Vantage[] = [
  { name: 'lake-noon', spot: 'lake', heading: 0, timeOfDay: 0.5 },
  { name: 'confluence-noon', spot: 'confluence', heading: Math.PI / 2, timeOfDay: 0.5 },
  { name: 'river-run-golden-hour', spot: 'run', heading: 'spot', timeOfDay: 0.72 },
  { name: 'network-noon', spot: 'network', heading: Math.PI, timeOfDay: 0.5 },
  { name: 'origin-night', spot: 'origin', heading: 0, timeOfDay: 0 },
];

export interface BenchOptions {
  url: string;
  /** Use the dev `?smoke` render budget. The E2E test sets this so software WebGL finishes. */
  smoke?: boolean;
  seed?: number;
  /** Rendered frames recorded per vantage. */
  frames: number;
  /** Rendered frames discarded after terrain finishes, before recording starts. */
  warmupFrames: number;
  /** Terrain visibility in metres. Defaults to the product default read from the page. */
  visibility?: number;
  vantageLimit?: number;
  deviceScaleFactor?: number;
  headless?: boolean;
  /** Source run in the page before the app loads; the E2E test uses it to fake GPU conditions. */
  initScript?: string;
}

export interface Stat { samples: number; min: number; p5: number; p50: number; p95: number; p99: number; max: number; mean: number }

export interface VantageResult {
  name: string;
  parameters: { spot: string; x: number; z: number; heading: number; timeOfDay: number; visibility: number; camera: Record<string, number> };
  rendered: number;
  counts: { calls: number; triangles: number; constant: boolean };
  held: { chunks: number; chunksAtEnd: number; pendingAtStart: number; pendingAtEnd: number; timeOfDay: number; qualityStep: number; frameCap: number | null; position: number[]; pixelRatio: number };
  /** requestAnimationFrame gap between frames. Latency and cadence: includes idle time. */
  frameIntervalMs: Stat;
  /** Time inside the frame callback. Main-thread active work: excludes GPU execution and idle waiting. */
  mainThreadWorkMs: Stat;
  /** Part of the work spent submitting the render call. */
  renderSubmitMs: Stat;
  /** GPU execution time of the render call, or null when no valid timing resolved. Never zero for unavailable. */
  gpuMs: Stat | null;
  /** Sum of callback time divided by the sum of frame intervals. */
  mainThreadBusyShare: number;
  /** Mean GPU time per rendered frame times rendered frames, divided by the sum of frame intervals. Null when unavailable. */
  gpuBusyShare: number | null;
  gpu: { reason: string | null; valid: number; discardedDisjoint: number; discardedInvalid: number; skipped: number };
}

export interface RoundResult {
  build: { commit: string; dirty: boolean; url: string };
  environment: {
    machine: { cpu: string; cores: number; memoryGiB: number; os: string; arch: string };
    browser: string;
    headless: boolean;
    glRenderer: string;
    viewport: number[];
    devicePixelRatio: number;
    pixelRatio: number;
  };
  parameters: { seed: number; smoke: boolean; frames: number; warmupFrames: number; visibility: number; profileFlag: string };
  gpu: { status: 'available' | 'partial' | 'unavailable'; reason: string | null; discardedDisjoint: number };
  leakedQueries: number;
  vantages: VantageResult[];
}

export function stat(values: number[]): Stat {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))]!;
  return { samples: sorted.length, min: sorted[0]!, p5: at(0.05), p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1)!,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length };
}

function gitState(): { commit: string; dirty: boolean } {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--', 'src', 'index.html', 'package.json').length > 0 };
}

export async function runBenchRound(browser: Browser, options: BenchOptions): Promise<RoundResult> {
  const seed = options.seed ?? 5;
  const flag = options.smoke ? '?smoke&profile' : '?profile';
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: options.deviceScaleFactor });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript((worldSeed) => localStorage.setItem('soaring.world-seed.v1', String(worldSeed)), seed);
  if (options.initScript) await page.addInitScript(options.initScript);
  await page.goto(`${options.url}/${flag}`);
  await page.waitForFunction(() => window.__SOARING__?.profile !== undefined, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    document.querySelector('#intro')?.classList.add('hidden');
    document.body.classList.add('cursor-hidden');
  });
  const visibility = options.visibility ?? await page.evaluate(() => window.__SOARING__.snapshot().requestedDistance);
  const spots = await page.evaluate(() => window.__SOARING__.reviewSpots());
  const vantages: VantageResult[] = [];
  let leakedQueries = 0;

  for (const vantage of VANTAGES.slice(0, options.vantageLimit ?? VANTAGES.length)) {
    const spot = vantage.spot === 'origin' ? { x: 0, z: 0 } : spots[vantage.spot];
    const heading = vantage.heading === 'spot' ? (spots.run.heading) : vantage.heading;
    // Existing hooks only: reviewFlight places the bird and freezes navigation, setTimeOfDay freezes the sky.
    const camera = await page.evaluate(({ x, z, heading, timeOfDay, visibility }) => {
      const app = window.__SOARING__;
      app.reviewFlight!({ x, z, heading });
      app.setTimeOfDay(timeOfDay);
      app.setVisibility(visibility);
      const [bx, by, bz] = app.snapshot().position as [number, number, number];
      // The follow-camera pose reviewFlight starts from, held explicitly so the camera cannot drift.
      const pose = { x: bx - Math.sin(heading) * 60, y: by + 30, z: bz - Math.cos(heading) * 60,
        lookX: bx + Math.sin(heading) * 38, lookY: by - 9, lookZ: bz + Math.cos(heading) * 38 };
      app.setViewpoint(pose);
      return pose;
    }, { x: spot.x, z: spot.z, heading, timeOfDay: vantage.timeOfDay, visibility });

    // Never record while terrain is pending, the fog colour read is in flight, or chunks still change.
    await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0, undefined, { timeout: 120_000 });
    await page.waitForFunction(() => { const fog = window.__SOARING__.snapshot().fog; return !fog.readPending && fog.samples > 0; }, undefined, { timeout: 30_000 });
    const settle = await page.evaluate(() => window.__SOARING__.snapshot().renderedFrames);
    await page.waitForFunction(({ from, count }) => window.__SOARING__.snapshot().renderedFrames >= from + count, { from: settle, count: options.warmupFrames }, { timeout: 120_000 });
    await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0, undefined, { timeout: 120_000 });

    const start = await page.evaluate(() => { window.__SOARING__.profile!.begin(); return window.__SOARING__.snapshot(); });
    await page.waitForFunction(({ from, count }) => window.__SOARING__.snapshot().renderedFrames >= from + count, { from: start.renderedFrames, count: options.frames }, { timeout: 120_000 });
    const end = await page.evaluate(() => { window.__SOARING__.profile!.end(); return window.__SOARING__.snapshot(); });
    // end() stops new queries; wait for the ones in flight to resolve or be discarded.
    await page.waitForFunction(() => window.__SOARING__.profile!.report().openQueries === 0, undefined, { timeout: 10_000 }).catch(() => undefined);
    const report = await page.evaluate(() => window.__SOARING__.profile!.report());
    leakedQueries += report.createdQueries - report.deletedQueries;

    const all = report.samples.filter((sample) => sample.intervalMs > 0 || sample.rendered);
    const rendered = report.samples.filter((sample) => sample.rendered);
    const resolved = rendered.filter((sample) => sample.gpuMs !== null).map((sample) => sample.gpuMs!);
    const intervalSum = all.reduce((sum, sample) => sum + sample.intervalMs, 0);
    vantages.push({
      name: vantage.name,
      parameters: { spot: vantage.spot, x: spot.x, z: spot.z, heading, timeOfDay: vantage.timeOfDay, visibility, camera },
      rendered: rendered.length,
      counts: { calls: rendered[0]!.calls, triangles: rendered[0]!.triangles,
        constant: rendered.every((sample) => sample.calls === rendered[0]!.calls && sample.triangles === rendered[0]!.triangles) },
      held: { chunks: start.chunks, chunksAtEnd: end.chunks, pendingAtStart: start.pending, pendingAtEnd: end.pending, timeOfDay: end.timeOfDay,
        qualityStep: end.qualityStep, frameCap: end.frameCap, position: end.position, pixelRatio: end.pixelRatio },
      frameIntervalMs: stat(all.filter((sample) => sample.intervalMs > 0).map((sample) => sample.intervalMs)),
      mainThreadWorkMs: stat(rendered.map((sample) => sample.workMs)),
      renderSubmitMs: stat(rendered.map((sample) => sample.renderMs)),
      gpuMs: resolved.length > 0 ? stat(resolved) : null,
      mainThreadBusyShare: all.reduce((sum, sample) => sum + sample.workMs, 0) / intervalSum,
      gpuBusyShare: resolved.length > 0 ? (resolved.reduce((sum, value) => sum + value, 0) / resolved.length) * rendered.length / intervalSum : null,
      gpu: { reason: resolved.length > 0 ? null : report.gpu.reason, valid: report.gpu.valid, discardedDisjoint: report.gpu.discardedDisjoint, discardedInvalid: report.gpu.discardedInvalid, skipped: report.gpu.skipped },
    });
  }

  const environment = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return { glRenderer: debug && gl ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      viewport: [innerWidth, innerHeight], devicePixelRatio, pixelRatio: window.__SOARING__.snapshot().pixelRatio };
  });
  await context.close();
  if (errors.length > 0) throw new Error(`Page errors during bench: ${errors.join(' | ')}`);

  const withGpu = vantages.filter((vantage) => vantage.gpuMs !== null).length;
  const status = withGpu === vantages.length ? 'available' : withGpu === 0 ? 'unavailable' : 'partial';
  const discardedDisjoint = vantages.reduce((sum, vantage) => sum + vantage.gpu.discardedDisjoint, 0);
  const reason = status === 'available' ? null : vantages.find((vantage) => vantage.gpu.reason !== null)?.gpu.reason ?? null;
  const cpus = os.cpus();
  return {
    build: { ...gitState(), url: options.url },
    environment: {
      machine: { cpu: cpus[0]?.model ?? 'unknown', cores: cpus.length, memoryGiB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}`, arch: os.arch() },
      browser: `${browser.browserType().name()} ${browser.version()}`,
      headless: options.headless ?? true,
      ...environment,
    },
    parameters: { seed, smoke: options.smoke ?? false, frames: options.frames, warmupFrames: options.warmupFrames, visibility, profileFlag: flag },
    gpu: { status, reason, discardedDisjoint },
    leakedQueries,
    vantages,
  };
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { VANTAGES } from '../scripts/perf-bench';
import { comparePictures, type Picture, type PictureEnvironment } from '../scripts/picture-diff';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
const output = process.env.PARITY_OUT ?? `artifacts/look-parity/${new Date().toISOString().replaceAll(':', '-')}-${commit.slice(0, 12)}`;
const repeats = Number(process.env.PARITY_REPEATS ?? 2);
const reference = process.env.PARITY_REFERENCE;
// Failure mode: wall-clock animation and settling drift hide a static refactor regression.
// Fixed-clock mode is for exact picture comparison, not performance measurement.
const fixedClock = process.env.PARITY_FIXED_CLOCK === '1';
const selectedNames = process.env.PARITY_VANTAGES?.split(',').filter(Boolean);
const selectedVantages = selectedNames ? VANTAGES.filter(({ name }) => selectedNames.includes(name)) : VANTAGES;
if (selectedNames && (selectedVantages.length === 0 || selectedVantages.length !== selectedNames.length)) throw new Error('PARITY_VANTAGES must name one or more known bench vantages');
if (!Number.isInteger(repeats) || repeats < 2) throw new Error('PARITY_REPEATS must be an integer of at least 2 to measure the noise floor');

test('capture and compare finished pictures at the performance bench vantages', async ({ browser }) => {
  const build = { commit, dirty };
  const environmentBase = {
    machine: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}`, arch: os.arch() },
    browser: `${browser.browserType().name()} ${browser.version()}`,
    headless: true,
  };
  const captures: Record<string, Picture[]> = Object.fromEntries(selectedVantages.map(({ name }) => [name, []]));

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.PARITY_DPR ?? 2) });
    const page = await context.newPage();
    if (fixedClock) {
      await page.clock.install({ time: 0 });
      await page.clock.pauseAt(1000);
      await page.addInitScript(() => {
        // Module loading can consume a few emulated milliseconds after navigation.
        // Pin animation initialization to zero, then use only emulated RAF time.
        // This hook is test-only; production animation and CPU budgets are untouched.
        let frameTime = 0;
        performance.now = () => frameTime;
        const requestFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) => requestFrame((time) => {
          frameTime = time;
          callback(time);
        });
      });
    }
    await page.addInitScript((seed) => localStorage.setItem('soaring.world-seed.v1', String(seed)), Number(process.env.PARITY_SEED ?? 5));
    await page.goto(`${process.env.PARITY_URL ?? 'http://127.0.0.1:4198'}/?profile`);
    await page.waitForFunction(() => window.__SOARING__?.profile !== undefined, undefined, { timeout: 60_000 });
    await page.evaluate(() => { document.querySelector('#intro')?.classList.add('hidden'); document.body.classList.add('cursor-hidden'); });
    const spots = await page.evaluate(() => window.__SOARING__.reviewSpots());
    const visibility = await page.evaluate(() => window.__SOARING__.snapshot().requestedDistance);

    for (const vantage of selectedVantages) {
      console.log(`Capturing ${vantage.name}, repeat ${repeat + 1}/${repeats}`);
      const spot = vantage.spot === 'origin' ? { x: 0, z: 0 } : spots[vantage.spot];
      const heading = vantage.heading === 'spot' ? spots.basin.heading : vantage.heading;
      await page.evaluate(({ x, z, heading, timeOfDay, visibility }) => {
        const app = window.__SOARING__;
        app.reviewFlight!({ x, z, heading });
        app.setTimeOfDay(timeOfDay);
        app.setVisibility(visibility);
        const [bx, by, bz] = app.snapshot().position as [number, number, number];
        app.setViewpoint({ x: bx - Math.sin(heading) * 60, y: by + 30, z: bz - Math.cos(heading) * 60,
          lookX: bx + Math.sin(heading) * 38, lookY: by - 9, lookZ: bz + Math.cos(heading) * 38 });
      }, { x: spot.x, z: spot.z, heading, timeOfDay: vantage.timeOfDay, visibility });
      if (fixedClock) {
        // Advance the same 160 frames for every held view. Fake performance.now()
        // also drains the CPU streaming budget within each frame. The scene,
        // materials, shadows, and animation remain real, at a repeatable time.
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.clock.runFor(2560);
        const state = await page.evaluate(() => window.__SOARING__.snapshot());
        console.log(`Fixed clock ${vantage.name}, repeat ${repeat + 1}: ${JSON.stringify({ frames: state.renderedFrames, cap: state.frameCap, cloudTime: state.cloudTime, fog: state.fog, position: state.position })}`);
        expect(state.pending).toBe(0);
        expect(state.fog.samples).toBeGreaterThan(0);
      } else {
      await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0, undefined, { timeout: 120_000 }).catch(async (error) => {
        const state = await page.evaluate(() => window.__SOARING__.snapshot());
        throw new Error(`Terrain did not settle at ${vantage.name}, repeat ${repeat + 1}: ${JSON.stringify(state)}`, { cause: error });
      });
      await page.waitForFunction(() => { const fog = window.__SOARING__.snapshot().fog; return !fog.readPending && fog.samples > 0; }, undefined, { timeout: 30_000 });
      const settled = await page.evaluate(() => window.__SOARING__.snapshot().renderedFrames);
      await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames >= frame + 60, settled, { timeout: 120_000 });
      }
      // A page capture avoids locator stability checks waiting for a paused RAF.
      const screenshot = fixedClock
        ? await page.screenshot({ style: 'body *:not(#app):not(canvas) { visibility: hidden !important; }' })
        : await page.locator('canvas').first().screenshot();
      const capture = await page.evaluate(async (png) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Could not read finished canvas screenshot pixels');
        context.drawImage(bitmap, 0, 0);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const source = document.querySelector('canvas');
        const gl = source?.getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return { width: image.width, height: image.height, pixels: Array.from(image.data), activePixels: image.data.reduce((count, value) => count + Number(value !== 0), 0),
          renderer: gl && debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unknown',
          viewport: [innerWidth, innerHeight] as [number, number], devicePixelRatio, pixelRatio: window.__SOARING__.snapshot().pixelRatio };
      }, screenshot.toString('base64'));
      const environment: PictureEnvironment = { browser: environmentBase.browser, renderer: capture.renderer, viewport: capture.viewport,
        devicePixelRatio: capture.devicePixelRatio, pixelRatio: capture.pixelRatio, machine: environmentBase.machine.cpu,
        os: environmentBase.machine.os, arch: environmentBase.machine.arch, headless: environmentBase.headless };
      expect(capture.activePixels, `Finished canvas screenshot at ${vantage.name} must contain rendered pixels`).toBeGreaterThan(0);
      captures[vantage.name]!.push({ width: capture.width, height: capture.height, pixels: new Uint8Array(capture.pixels), environment, build });
    }
    await context.close();
  }

  const existing = reference ? path.resolve(reference) : undefined;
  if (existing) {
    const previous = JSON.parse(await readFile(path.join(existing, 'parity.json'), 'utf8'));
    expect(previous.parameters.fixedClock ?? false, 'Reference clock mode must match').toBe(fixedClock);
  }
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  const result: Record<string, unknown> = { generated: new Date().toISOString(), build, environment: environmentBase,
    parameters: { fixedClock, seed: Number(process.env.PARITY_SEED ?? 5), repeats, deviceScaleFactor: Number(process.env.PARITY_DPR ?? 2), vantages: selectedVantages.map(({ name }) => name) }, vantages: {} };
  for (const [name, pictures] of Object.entries(captures)) {
    const [baseline, repeated] = pictures;
    const noiseFloor = comparePictures(baseline!, repeated!);
    const referencePicture = existing ? await loadPicture(path.join(existing, `${name}-repeat-1.rgba.gz`), path.join(existing, `${name}.json`)) : undefined;
    const againstReference = referencePicture ? comparePictures(referencePicture, baseline!) : undefined;
    for (let index = 0; index < pictures.length; index += 1) {
      const picture = pictures[index]!;
      await writeFile(path.join(output, `${name}-repeat-${index + 1}.rgba.gz`), gzipSync(Buffer.from(picture.pixels)));
    }
    await writeFile(path.join(output, `${name}.json`), JSON.stringify({ width: baseline!.width, height: baseline!.height, environment: baseline!.environment, build }, null, 2));
    (result.vantages as Record<string, unknown>)[name] = { noiseFloor, againstReference };
    console.log(`${name}: noise mean ${noiseFloor.meanDifference.toFixed(4)} levels, changed ${(noiseFloor.changedPixelShare * 100).toFixed(4)}%, worst ${noiseFloor.worstPixel.difference}; reference ${againstReference ? `${againstReference.meanDifference.toFixed(4)} levels, ${(againstReference.changedPixelShare * 100).toFixed(4)}%, worst ${againstReference.worstPixel.difference}` : 'not supplied'}`);
  }
  await writeFile(path.join(output, 'parity.json'), JSON.stringify(result, null, 2));
  console.log(`Saved versioned picture artifacts to ${output}`);
});

async function loadPicture(pixelsPath: string, metadataPath: string): Promise<Picture> {
  const [pixels, metadata] = await Promise.all([readFile(pixelsPath), readFile(metadataPath)]);
  const details = JSON.parse(metadata.toString()) as Omit<Picture, 'pixels'>;
  return { ...details, pixels: new Uint8Array(gunzipSync(pixels)) };
}

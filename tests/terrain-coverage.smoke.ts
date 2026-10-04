import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Failure modes: a tile crossing pulls the haze in and hides land that is already drawn; a jump
// shows ground that is not built yet; a render-origin rebase moves or drops displayed ground.
// The public capture pose and visible horizon are the seams, not private tile bookkeeping.
const pose = (x: number) => ({ x, y: 350, z: -3239, lookX: x, lookY: 280, lookZ: -1439 });
// x = -1440 is a fine and a coarse tile boundary. The jump of 17 coarse tiles keeps that alignment
// and moves the eagle more than 10 km, so the render origin rebases. It lands where green land is
// within Low power's 3.5 km haze.
const JUMP = 17 * 1440;
// CI's software renderer checks bounded work, not repeated full 5 km loads (see docs/testing.md):
// there, one normal crossing runs in the reduced smoke renderer. Locally, ordinary rendering covers
// both modes, the jump and the rebase.
const ci = Boolean(process.env.CI);

for (const lowPower of ci ? [false] : [false, true]) {
  test(`keeps intact distant land visible while crossing terrain boundaries (${lowPower ? 'Low power' : 'normal'})`, async ({ page }, info) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1374, height: 870 });
    await page.addInitScript((lowPower) => {
      localStorage.setItem('soaring.world-seed.v1', '2272854000');
      localStorage.setItem('soaring.settings.v1', JSON.stringify({ terrainVisibility: 5000, lowPower }));
    }, lowPower);
    await page.goto(ci ? '/?smoke' : '/');
    const coldStart = Date.now();
    await page.evaluate((start) => {
      const app = window.__SOARING__;
      app.pauseFlight();
      app.setTimeOfDay(.5);
      app.setViewpoint(start);
    }, pose(-1441));
    // Record progress, so a slow or stuck load explains itself in the failure and the evidence.
    const loading: string[] = [];
    while (!await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0, undefined, { timeout: 5000, polling: 250 }).then(() => true, () => false)) {
      const s = await page.evaluate(() => window.__SOARING__.snapshot());
      loading.push(`${Math.round((Date.now() - coldStart) / 1000)} s: pending ${s.pending}, visible ${Math.round(s.visibleDistance)} m, quality ${s.qualityStep}, ${s.ground}`);
      if (Date.now() - coldStart > 420_000) throw new Error(`Terrain did not finish loading:\n${loading.slice(-12).join('\n')}`);
    }
    const coldLoadMs = Date.now() - coldStart;

    const evidence = await page.evaluate(async ({ before, after, jump }) => {
      const app = window.__SOARING__;
      const canvas = document.querySelector('canvas')!;
      const gl = canvas.getContext('webgl2')!;
      const animationFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      let lastFrame = app.snapshot().renderedFrames;
      // The next frame the app draws. Low power skips frames, and a callback can also run after the
      // browser presented and cleared the buffer, before this frame's draw; neither is a drawn frame.
      const drawn = async () => {
        for (;;) {
          await animationFrame();
          const s = app.snapshot();
          if (s.renderedFrames === lastFrame) continue;
          const pixels = new Uint8Array(gl.drawingBufferWidth * 100 * 4);
          gl.readPixels(0, Math.round(gl.drawingBufferHeight * .46), gl.drawingBufferWidth, 100, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let green = 0;
          let lit = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 1]! > pixels[i]! * 1.08 && pixels[i + 1]! > pixels[i + 2]! * 1.05) green++;
            if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 0) lit++;
          }
          if (lit === 0) continue;
          lastFrame = s.renderedFrames;
          // Adaptive quality may cap visibility at 3500 m on a slow machine; that cap is not a coverage loss.
          const visibility = s.qualityStep >= 3 ? Math.min(3500, s.requestedDistance) : s.requestedDistance;
          return { frame: s.renderedFrames, visibleDistance: s.visibleDistance, visibility, pending: s.pending,
            renderOrigin: s.renderOrigin, green, drawCalls: s.drawCalls, geometries: s.geometries };
        }
      };
      const images: string[] = [];
      const capture = async () => {
        const s = await drawn();
        images.push(canvas.toDataURL());
        return s;
      };
      // Two metres cross the fine AND coarse x boundary; the look direction is unchanged.
      const cross = async (from: typeof before, to: typeof after) => {
        app.setViewpoint(from);
        const start = await capture();
        app.setViewpoint(to);
        const trace = [];
        for (let i = 0; i < 90; i++) trace.push(i === 1 ? await capture() : await drawn());
        images.push(canvas.toDataURL());
        return { start, trace };
      };
      const first = await cross(before, after);

      // Jump far enough to rebase the render origin and discard every displayed ground level.
      const shift = (pose: typeof before) => ({ ...pose, x: pose.x + jump, lookX: pose.lookX + jump });
      const jumpTrace = [];
      let second = null;
      if (jump) {
        app.reviewFlight!({ x: before.x + jump, z: before.z + 150, heading: 0 });
        app.setViewpoint(shift(before));
        jumpTrace.push(await capture());
        const jumpStart = performance.now();
        while (jumpTrace.at(-1)!.pending > 0 && performance.now() - jumpStart < 420_000) jumpTrace.push(await drawn());
        second = await cross(shift(before), shift(after));
      }

      const columns = 3;
      const strip = document.createElement('canvas');
      strip.width = columns * 458; strip.height = Math.ceil(images.length / columns) * 290;
      const context = strip.getContext('2d')!;
      for (let i = 0; i < images.length; i++) {
        const image = new Image(); image.src = images[i]!; await image.decode();
        context.drawImage(image, (i % columns) * 458, Math.floor(i / columns) * 290, 458, 290);
      }
      return { first, jumpTrace, second, strip: strip.toDataURL() };
    }, { before: pose(-1441), after: pose(-1439), jump: ci ? 0 : JUMP });
    const { strip, ...trace } = evidence;
    // The jump is long in Low power; keep the frames where visibility or the origin changed.
    const jumpTrace = trace.jumpTrace.filter((s, i, all) => i === 0 || i === all.length - 1
      || s.visibleDistance !== all[i - 1]!.visibleDistance || s.renderOrigin[0] !== all[i - 1]!.renderOrigin[0]);
    await writeFile(info.outputPath('coverage-trace.json'), JSON.stringify({ lowPower, coldLoadMs, loading, ...trace, jumpFrames: trace.jumpTrace.length, jumpTrace }, null, 2));
    // In order: crossing before/during/after; first frame after the jump; crossing before/during/after the rebase.
    await writeFile(info.outputPath('before-during-after.png'), Buffer.from(strip.split(',')[1]!, 'base64'));

    for (const crossing of evidence.second ? [evidence.first, evidence.second] : [evidence.first]) {
      expect(crossing.start.visibleDistance).toBeCloseTo(crossing.start.visibility, 3);
      // The crossing really starts streaming work; it must not pull the haze over drawn land.
      expect(crossing.trace.some((s) => s.pending > 0)).toBe(true);
      for (const s of crossing.trace) expect(s.visibleDistance).toBeCloseTo(s.visibility, 3);
      expect(Math.min(...crossing.trace.map((s) => s.green))).toBeGreaterThan(crossing.start.green * .85);
    }
    expect(evidence.first.start.green).toBeGreaterThan(ci ? 300 : 1000);
    if (ci) return;
    // Unbuilt ground stays hidden: haze closes on the camera until the new ground is valid.
    const jumped = evidence.jumpTrace;
    expect(jumped[0]!.visibleDistance).toBe(0);
    expect(jumped[0]!.renderOrigin[0]! - evidence.first.start.renderOrigin[0]!).toBeGreaterThan(10_000);
    expect(jumped.at(-1)!.pending).toBe(0);
    expect(jumped.at(-1)!.visibleDistance).toBeCloseTo(jumped.at(-1)!.visibility, 3);
    for (let i = 1; i < jumped.length; i++) {
      if (jumped[i]!.visibility === jumped[i - 1]!.visibility) expect(jumped[i]!.visibleDistance).toBeGreaterThanOrEqual(jumped[i - 1]!.visibleDistance);
    }
  });
}

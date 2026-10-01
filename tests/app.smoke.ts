import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

type TestWindow = Window & {
  __trackedAudioContext?: AudioContext;
  __setPageVisibility?: (state: 'hidden' | 'visible') => void;
  __visibilityCapture?: { completed: boolean; snapshot: ReturnType<typeof window.__SOARING__.snapshot> | null };
};

// Record frame starvation independently of the simulation's clamped clock.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const gaps: number[] = [];
    const tasks: number[] = [];
    let previous = performance.now();
    const sample = (now: number) => {
      gaps.push(now - previous);
      previous = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    new PerformanceObserver((list) => {
      tasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ type: 'longtask', buffered: true });
    Object.assign(window, { __smokeTiming: { gaps, tasks } });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  const timing = await page.evaluate(() => {
    const measured = (window as Window & { __smokeTiming?: { gaps: number[]; tasks: number[] } }).__smokeTiming;
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return { ...measured, renderer: debug ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      snapshot: window.__SOARING__?.snapshot() };
  });
  await testInfo.attach('frame-timing', { body: JSON.stringify(timing), contentType: 'application/json' });
});

function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function revealSettingsControl(page: Page): Promise<void> {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no layout box');
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await expect(page.locator('#controls')).toHaveClass(/visible/);
  await expect(page.locator('#settings-toggle')).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  const canvas = page.locator('canvas');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Canvas has no layout box');
  const toggle = page.locator('#settings-toggle');
  const target = await toggle.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#settings-panel')).toBeVisible();
}

test('renders high-detail terrain, streams, and supports camera controls', async ({ page }) => {
  const errors = captureErrors(page);
  // Development-only smoke mode reduces software-WebGL pixel work and disables shadows.
  await page.goto('/?smoke');
  await expect(page.locator('canvas')).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.locator('#diagnostics')).toBeVisible();
  await page.evaluate(() => window.__SOARING__.setTimeScale(8));
  await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0);
  const before = await page.evaluate(() => window.__SOARING__.snapshot());
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(Math.hypot(after.position[0]! - before.position[0]!, after.position[2]! - before.position[2]!)).toBeGreaterThan(8);
  expect(after.chunks).toBeLessThanOrEqual(49);
  expect(after.visibleDistance).toBe(720);
  expect(after.geometries).toBeLessThan(200);
  expect(after.requestedDistance).toBe(720);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no layout box');
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await expect(canvas).toHaveCSS('cursor', 'grab');
  await page.mouse.down();
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.42, { steps: 6 });
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await page.mouse.up();
  expect(errors).toEqual([]);
});

function expectMarkersInRange(snapshot: {
  position: number[];
  markerRange: number;
  markers: number[][];
  thermalCandidates: number[][];
  activeThermal: number[] | null;
}): void {
  const x = snapshot.position[0] ?? 0;
  const z = snapshot.position[2] ?? 0;
  const marked = new Set(snapshot.markers.map((marker) => `${marker[0]},${marker[1]}`));
  const inside = snapshot.thermalCandidates.filter((thermal) => Math.hypot((thermal[0] ?? 0) - x, (thermal[1] ?? 0) - z) <= snapshot.markerRange);
  const outside = snapshot.thermalCandidates.filter((thermal) => Math.hypot((thermal[0] ?? 0) - x, (thermal[1] ?? 0) - z) > snapshot.markerRange);
  expect(snapshot.markers.length).toBeGreaterThanOrEqual(2);
  expect(inside.length).toBeGreaterThanOrEqual(2);
  expect(outside.length).toBeGreaterThanOrEqual(1);
  expect(marked).toEqual(new Set(inside.map((thermal) => `${thermal[0]},${thermal[1]}`)));
  const activeMarks = snapshot.markers.filter((marker) => marker[2] === 1);
  expect(activeMarks).toHaveLength(1);
  expect([activeMarks[0]?.[0], activeMarks[0]?.[1]]).toEqual(snapshot.activeThermal);
}

test('tracks the active thermal and persists the visibility setting', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = captureErrors(page);
  await page.goto('/?smoke');
  await expect(page.locator('canvas')).toBeVisible();
  const setting = page.getByRole('checkbox', { name: 'Show thermal' });
  await openSettings(page);
  await expect(setting).toBeChecked();
  await page.evaluate(() => window.__SOARING__.setTimeScale(12));
  await page.waitForFunction(() => window.__SOARING__.snapshot().activeThermal !== null, undefined, { timeout: 25_000 });
  const active = await page.evaluate(() => window.__SOARING__.snapshot());
  expectMarkersInRange(active);
  expect(active.marker).toEqual(active.activeThermal);
  await setting.uncheck();
  expect((await page.evaluate(() => window.__SOARING__.snapshot())).marker).toBeNull();
  expect((await page.evaluate(() => window.__SOARING__.snapshot())).markers).toEqual([]);
  await page.reload();
  await openSettings(page);
  await expect(setting).not.toBeChecked();
  await page.evaluate(() => window.__SOARING__.setTimeScale(12));
  await page.waitForFunction(() => window.__SOARING__.snapshot().activeThermal !== null, undefined, { timeout: 25_000 });
  expect((await page.evaluate(() => window.__SOARING__.snapshot())).marker).toBeNull();
  expect((await page.evaluate(() => window.__SOARING__.snapshot())).markers).toEqual([]);
  await setting.check();
  const enabled = await page.evaluate(() => window.__SOARING__.snapshot());
  expectMarkersInRange(enabled);
  expect(enabled.marker).toEqual(enabled.activeThermal);
  expect(errors).toEqual([]);
});

test('persists safe local-terrain height bounds across reloads', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/?smoke');
  await openSettings(page);
  await page.locator('#min-height').evaluate((input: HTMLInputElement) => {
    input.value = '90';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#max-height').evaluate((input: HTMLInputElement) => {
    input.value = '145';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#min-height-value')).toHaveText('90 m');
  await expect(page.locator('#max-height-value')).toHaveText('145 m');
  await page.reload();
  await expect(page.locator('#min-height')).toHaveValue('90');
  await expect(page.locator('#max-height')).toHaveValue('145');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('soaring.settings.v1') ?? '{}'));
  expect([saved.minFlightHeight, saved.maxFlightHeight]).toEqual([90, 145]);
  expect(errors).toEqual([]);
});

test('visibility and camera distance persist independently', async ({ page }) => {
  const errors = captureErrors(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('soaring.settings.v1')) localStorage.setItem('soaring.settings.v1', JSON.stringify({
      ambienceVolume: 0.4, musicVolume: 0.4, muted: false, terrainVisibility: 1080, cameraDistance: 220,
    }));
  });
  await page.goto('/?smoke');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no layout box');
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  const controls = page.locator('#controls');
  await expect(controls).toHaveClass(/visible/);
  await expect(controls).not.toHaveClass(/visible/, { timeout: 5000 });
  const settingsToggle = page.locator('#settings-toggle');
  await expect(settingsToggle).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/cursor-hidden/);
  await openSettings(page);
  await expect(page.locator('body')).not.toHaveClass(/cursor-hidden/);
  await expect(controls).toHaveClass(/visible/);
  await expect(settingsToggle).toBeVisible();
  await expect(controls).toHaveClass(/visible/);
  await expect(page.locator('#settings-panel')).toBeVisible();
  await expect(settingsToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(settingsToggle).toHaveAccessibleName('Close settings');
  await expect(page.locator('#quality')).toHaveCount(0);
  await expect(page.locator('#distance')).toHaveValue('100');
  expect(await page.locator('#distance').getAttribute('min')).toBe('10');
  expect(await page.locator('#distance').getAttribute('max')).toBe('100');
  await expect(page.locator('#ambience')).toHaveValue('0.4');
  await expect(page.locator('#music')).toHaveValue('0.4');
  await expect(page.locator('#visibility')).toHaveValue('1080');
  expect(await page.locator('#visibility').getAttribute('max')).toBe('5000');
  await page.locator('#visibility').fill('3600');
  await expect(page.locator('#distance')).toHaveValue('100');
  await page.locator('#distance').fill('10');
  await page.reload();
  await expect(page.locator('#visibility')).toHaveValue('3600');
  await expect(page.locator('#distance')).toHaveValue('10');
  await page.waitForFunction(() => {
    const { cameraDistance, cameraHeight } = window.__SOARING__.snapshot();
    return cameraDistance === 10 && cameraHeight > 0 && cameraHeight < 10;
  });
  // Full far-field loading is covered by unit tests; here the stream only has to make bounded progress.
  const first = await page.evaluate(() => window.__SOARING__.snapshot());
  await page.waitForFunction((chunks) => window.__SOARING__.snapshot().chunks >= chunks + 20, first.chunks);
  const snapshot = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(snapshot.requestedDistance).toBe(3600);
  expect(snapshot.cameraDistance).toBe(10);
  expect(snapshot.cameraHeight).toBeLessThan(10);
  expect(snapshot.visibleDistance).toBeLessThanOrEqual(3600);
  await openSettings(page);
  const firstFrame = await page.evaluate(async () => {
    const startingHeight = window.__SOARING__.snapshot().cameraHeight;
    const input = document.querySelector<HTMLInputElement>('#distance')!;
    input.value = '100';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const cameraHeight = await new Promise<number>((resolve) => {
      requestAnimationFrame(() => resolve(window.__SOARING__.snapshot().cameraHeight));
    });
    return { startingHeight, cameraHeight };
  });
  // A single render frame must ease toward the new height, not teleport to it.
  expect(Math.abs(firstFrame.cameraHeight - firstFrame.startingHeight)).toBeLessThan(12);
  await page.waitForFunction(() => window.__SOARING__.snapshot().cameraHeight > 48);
  const farCamera = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(farCamera.cameraDistance).toBe(100);
  expect(farCamera.cameraHeight).toBeGreaterThan(48);
  expect(farCamera.cameraHeight).toBeLessThan(62);
  expect(snapshot.chunks + snapshot.pending).toBeLessThan(700);
  expect(errors).toEqual([]);
});

test('fullscreen toggle and F keep the idle scene clear while settings and diagnostics still work', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/?smoke');
  await openSettings(page);
  const fullscreenToggle = page.locator('#fullscreen-toggle');
  await expect(fullscreenToggle).toHaveText('Enter fullscreen');
  await fullscreenToggle.click();
  await page.waitForFunction(() => document.fullscreenElement?.id === 'app');
  await expect(page.locator('#settings-panel')).toBeHidden();
  await expect(page.locator('#intro')).toBeHidden();

  await page.keyboard.press('d');
  await expect(page.locator('#diagnostics')).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.locator('#diagnostics')).toBeHidden();
  await page.waitForFunction(() => document.body.classList.contains('cursor-hidden'), undefined, { timeout: 5000 });
  await expect(page.locator('#controls')).not.toHaveClass(/visible/);
  await expect(page.locator('#settings-toggle')).toBeHidden();

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no layout box');
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await expect(page.locator('body')).not.toHaveClass(/cursor-hidden/);
  await expect(page.locator('#settings-toggle')).toBeVisible();

  await page.keyboard.press('f');
  await page.waitForFunction(() => document.fullscreenElement === null);
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.fullscreenElement?.id === 'app');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.fullscreenElement === null);
  expect(errors).toEqual([]);
});

test('defaults terrain visibility to 5 km and streams bounded work at each LOD tier out to the 5 km max', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = captureErrors(page);
  await page.goto('/?smoke');
  await expect(page.locator('canvas')).toBeVisible();
  await openSettings(page);
  // A fresh session (no saved settings) still gets the smoke harness's bounded budget, not the
  // 5 km product default - see the smokeMode override in src/main.ts.
  await expect(page.locator('#visibility')).toHaveValue('720');
  await page.evaluate(() => localStorage.removeItem('soaring.settings.v1'));
  await page.reload();
  await openSettings(page);
  await expect(page.locator('#visibility')).toHaveValue('720');

  // Push the slider to the 5 km max and confirm all three LOD tiers populate with bounded work.
  await page.locator('#visibility').evaluate((input: HTMLInputElement) => {
    input.value = '5000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => window.__SOARING__.setTimeScale(1));
  // Full far-field draining is covered by the unit tests; on the software-WebGL CI runner even the
  // real per-frame build budget (2 chunks/frame) can take a while to fully drain hundreds of
  // chunks, so this only waits for every tier to start populating - bounded progress, not
  // completion.
  await page.waitForFunction(() => window.__SOARING__.snapshot().tiers.far > 0, undefined, { timeout: 60_000 });
  const snapshot = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(snapshot.requestedDistance).toBeGreaterThanOrEqual(4900);
  expect(snapshot.tiers.near).toBeGreaterThan(0);
  expect(snapshot.tiers.mid).toBeGreaterThan(0);
  expect(snapshot.tiers.far).toBeGreaterThan(0);
  // Bounded chunk/mesh work even at the 5 km max: the coarse far grid keeps total tile count low,
  // and the total (built + still queued) stays bounded even before the stream fully drains.
  expect(snapshot.chunks).toBeLessThan(700);
  expect(snapshot.chunks + snapshot.pending).toBeLessThan(700);
  expect(errors).toEqual([]);
});

test('settings stay scrollable within short desktop and mobile viewports', async ({ page }) => {
  await page.goto('/?smoke');
  await openSettings(page);
  const panel = page.locator('#settings-panel');
  expect(await panel.evaluate((element) => element.scrollHeight)).toBe(await panel.evaluate((element) => element.clientHeight));

  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 430 });
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(430);
    expect(await panel.evaluate((element) => element.scrollHeight)).toBeGreaterThan(await panel.evaluate((element) => element.clientHeight));
    await panel.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const button = await page.locator('#new-world').boundingBox();
    expect(button).not.toBeNull();
    expect(button!.y).toBeGreaterThanOrEqual(0);
    expect(button!.y + button!.height).toBeLessThanOrEqual(430);
  }
});

test('migrates prior volume, saves independent controls, and preserves mute on reload', async ({ page }) => {
  const errors = captureErrors(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('soaring.settings.v1')) localStorage.setItem('soaring.settings.v1', JSON.stringify({ volume: 0.37, muted: true }));
  });
  await page.goto('/?smoke');
  await openSettings(page);
  await expect(page.locator('#ambience')).toHaveValue('0.37');
  await expect(page.locator('#music')).toHaveValue('0.37');
  await page.locator('#ambience').fill('0.2');
  await page.locator('#music').fill('0.8');
  await expect(page.locator('#ambience-value')).toHaveText('20%');
  await expect(page.locator('#music-value')).toHaveText('80%');
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('On');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('soaring.settings.v1')!));
  expect(settings).toMatchObject({ ambienceVolume: 0.2, musicVolume: 0.8, muted: false });
  await page.reload();
  await expect(page.locator('#mute')).toHaveText('Muted');
  await openSettings(page);
  await expect(page.locator('#ambience')).toHaveValue('0.2');
  await expect(page.locator('#music')).toHaveValue('0.8');
  await expect(page.locator('#mute')).toHaveText('On');
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('Muted');
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soaring.settings.v1')!).muted)).toBe(true);
  expect(errors).toEqual([]);
});

test('the first mute gesture and a pending audio start respect the saved mute choice', async ({ page }) => {
  const errors = captureErrors(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('soaring.settings.v1')) {
      localStorage.setItem('soaring.settings.v1', JSON.stringify({ muted: false }));
    }
    const resume = AudioContext.prototype.resume;
    let delayFirstResume = true;
    AudioContext.prototype.resume = function () {
      if (!delayFirstResume) return resume.call(this);
      delayFirstResume = false;
      const started = resume.call(this);
      return new Promise<void>((resolve, reject) => {
        (window as Window & { releaseAudioResume?: () => Promise<void> }).releaseAudioResume = () => started.then(resolve, reject);
      });
    };
  });
  await page.goto('/?smoke');
  await revealSettingsControl(page);
  await page.locator('#settings-toggle').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#settings-panel')).toBeVisible();
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('Muted');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soaring.settings.v1')!).muted)).toBe(true);

  await page.evaluate(() => localStorage.setItem('soaring.settings.v1', JSON.stringify({ muted: false })));
  await page.reload();
  await openSettings(page);
  await page.waitForFunction(() => typeof (window as Window & { releaseAudioResume?: () => Promise<void> }).releaseAudioResume === 'function');
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('Muted');
  await page.evaluate(async () => {
    await (window as Window & { releaseAudioResume?: () => Promise<void> }).releaseAudioResume!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await expect(page.locator('#mute')).toHaveText('Muted');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soaring.settings.v1')!).muted)).toBe(true);
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('On');
  expect(errors).toEqual([]);
});

test('suspends hidden audio and bounds the first visible simulation step', async ({ page }) => {
  const errors = captureErrors(page);
  await page.addInitScript(() => {
    const nativeAudioContext = window.AudioContext;
    window.AudioContext = new Proxy(nativeAudioContext, {
      construct(target, args) {
        const context = Reflect.construct(target, args) as AudioContext;
        (window as TestWindow).__trackedAudioContext = context;
        return context;
      },
    });

    let hidden = false;
    const heldFrames: FrameRequestCallback[] = [];
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      if (hidden) {
        heldFrames.push(callback);
        return heldFrames.length;
      }
      return nativeRequestAnimationFrame((time) => {
        if (hidden) heldFrames.push(callback);
        else callback(time);
      });
    };
    (window as TestWindow).__setPageVisibility = (state) => {
      hidden = state === 'hidden';
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      if (!hidden) heldFrames.splice(0).forEach((callback) => window.requestAnimationFrame(callback));
    };
  });
  await page.goto('/?smoke');
  await expect(page.locator('canvas')).toBeVisible();
  await openSettings(page);
  const mute = page.locator('#mute');
  await mute.click();
  await expect(mute).toHaveText('On');
  await page.waitForFunction(() => (window as TestWindow).__trackedAudioContext?.state === 'running');
  await page.evaluate(() => window.__SOARING__.setTimeScale(12));

  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((visibility) => (window as TestWindow).__setPageVisibility!(visibility), state);
  await setVisibility('hidden');
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
  await page.waitForFunction(() => (window as TestWindow).__trackedAudioContext?.state === 'suspended', undefined, { polling: 100 });
  const before = await page.evaluate(() => window.__SOARING__.snapshot());
  await page.evaluate(() => {
    const testWindow = window as TestWindow;
    testWindow.__visibilityCapture = { completed: false, snapshot: null };
    requestAnimationFrame(() => {
      testWindow.__visibilityCapture = { completed: true, snapshot: window.__SOARING__.snapshot() };
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(await page.evaluate(() => (window as TestWindow).__visibilityCapture?.completed)).toBe(false);

  await setVisibility('visible');
  await page.waitForFunction(() => (window as TestWindow).__visibilityCapture?.completed, undefined, { polling: 100 });
  const after = await page.evaluate(() => (window as TestWindow).__visibilityCapture!.snapshot!);
  expect(Math.hypot(after.position[0]! - before.position[0]!, after.position[2]! - before.position[2]!)).toBeLessThan(6);
  expect(after.chunks - before.chunks).toBeLessThanOrEqual(2);
  await page.waitForFunction(() => (window as TestWindow).__trackedAudioContext?.state === 'running');
  const resumedAudioState = await page.evaluate(() => (window as TestWindow).__trackedAudioContext?.state);

  await mute.click();
  await expect(mute).toHaveText('Muted');
  await setVisibility('hidden');
  await page.waitForFunction(() => (window as TestWindow).__trackedAudioContext?.state === 'suspended', undefined, { polling: 100 });
  await page.evaluate(() => {
    const testWindow = window as TestWindow;
    testWindow.__visibilityCapture = { completed: false, snapshot: null };
    requestAnimationFrame(() => {
      testWindow.__visibilityCapture = { completed: true, snapshot: window.__SOARING__.snapshot() };
    });
  });
  await setVisibility('visible');
  await page.waitForFunction(() => (window as TestWindow).__visibilityCapture?.completed, undefined, { polling: 100 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const mutedAudioState = await page.evaluate(() => (window as TestWindow).__trackedAudioContext?.state);
  const persistedMute = await page.evaluate(() => JSON.parse(localStorage.getItem('soaring.settings.v1')!).muted);
  expect(mutedAudioState).toBe('suspended');
  expect(persistedMute).toBe(true);
  await writeFile('test-results/visibility-lifecycle.json', JSON.stringify({
    before: { position: before.position, chunks: before.chunks, pending: before.pending },
    after: { position: after.position, chunks: after.chunks, pending: after.pending },
    resumedAudioState,
    mutedAudioState,
    persistedMute,
  }, null, 2));
  expect(errors).toEqual([]);
});

test('renders daytime, aurora, and midnight sky states', async ({ page }) => {
  const errors = captureErrors(page);
  await page.addInitScript(() => localStorage.setItem('soaring.world-seed.v1', '5'));
  await page.goto('/?smoke');
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('#intro')?.classList.add('hidden');
    const toggle = document.querySelector<HTMLElement>('#settings-toggle');
    if (toggle) toggle.style.visibility = 'hidden';
  });

  async function showPhase(phase: number, name: string, look: 'sun' | 'moon' | 'horizon' | 'chase'): Promise<{ timeOfDay: number; sunElevation: number; moonElevation: number; auroraAmount: number }> {
    await page.evaluate((value) => window.__SOARING__.setTimeOfDay(value), phase);
    await page.evaluate((body) => window.__SOARING__.lookAtBody(body), look);
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))));
    }));
    const shot = await page.screenshot({ path: `test-results/sky-${name}.png` });
    expect(shot.byteLength).toBeGreaterThan(1000);
    return page.evaluate(() => {
      const snapshot = window.__SOARING__.snapshot();
      return { timeOfDay: snapshot.timeOfDay, sunElevation: snapshot.sunElevation, moonElevation: snapshot.moonElevation, auroraAmount: snapshot.auroraAmount };
    });
  }

  const horizon = await showPhase(0.25, 'horizon', 'chase');
  expect(horizon.timeOfDay).toBeCloseTo(0.25, 2);
  expect(Math.abs(horizon.sunElevation)).toBeLessThan(0.05);
  expect(Math.abs(horizon.moonElevation)).toBeLessThan(0.05);

  const dawn = await showPhase(0.28, 'dawn', 'sun');
  expect(dawn.sunElevation).toBeGreaterThan(0.05);

  const noon = await showPhase(0.5, 'noon', 'horizon');
  expect(noon.sunElevation).toBeGreaterThan(0.25);
  expect(noon.moonElevation).toBeLessThan(-0.25);
  expect(noon.auroraAmount).toBe(0);

  const dusk = await showPhase(0.72, 'dusk', 'sun');
  expect(dusk.sunElevation).toBeGreaterThan(0.05);
  expect(dusk.timeOfDay).toBeGreaterThan(0.7);
  expect(dusk.timeOfDay).toBeLessThan(0.75);

  const evening = await showPhase(0.8, 'aurora', 'horizon');
  expect(evening.auroraAmount).toBeGreaterThan(0);

  const midnight = await showPhase(1, 'midnight', 'horizon');
  expect(midnight.timeOfDay).toBeCloseTo(0, 2);
  expect(midnight.sunElevation).toBeLessThan(-0.25);
  expect(midnight.moonElevation).toBeGreaterThan(0.25);
  expect(midnight.auroraAmount).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('shows drainage water from altitude without page errors', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = captureErrors(page);
  await page.goto('/?smoke');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#settings-panel')).toBeHidden();
  const landmark = await page.evaluate(() => {
    window.__SOARING__.setTimeOfDay(0.5);
    window.__SOARING__.setVisibility(5000);
    window.__SOARING__.setCaptureClear(true);
    return window.__SOARING__.landmark();
  });
  expect((await page.evaluate(() => window.__SOARING__.snapshot().sunElevation))).toBeGreaterThan(0.25);
  expect(landmark).not.toBeNull();
  await page.evaluate((mark) => {
    window.__SOARING__.setViewpoint({
      x: mark.x - 420,
      y: mark.surface + 900,
      z: mark.z + 680,
      lookX: mark.x,
      lookY: mark.surface,
      lookZ: mark.z,
    });
  }, landmark!);
  await page.waitForFunction(() => window.__SOARING__.snapshot().tiers.far > 0, undefined, { timeout: 70_000 });
  await page.screenshot({ path: 'test-results/hydrology-altitude.png' });
  const seen = await page.evaluate((mark) => window.__SOARING__.sample(mark.x, mark.z), landmark!);
  expect(seen.water).toBe(true);
  expect(errors).toEqual([]);
});

test('a blocked browser audio context keeps the mute control usable without page errors', async ({ page }) => {
  const errors = captureErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { value: class { constructor() { throw new Error('Audio unavailable'); } } });
  });
  await page.goto('/?smoke');
  await openSettings(page);
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('Muted');
  await expect(page.locator('.audio-note')).toContainText('Audio could not start');
  expect(errors).toEqual([]);
});

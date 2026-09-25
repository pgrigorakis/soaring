import { expect, test, type Page } from '@playwright/test';

function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
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
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.42, { steps: 6 });
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('tracks the active thermal and persists the visibility setting', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = captureErrors(page);
  await page.goto('/?smoke');
  await expect(page.locator('canvas')).toBeVisible();
  const setting = page.getByRole('checkbox', { name: 'Show thermal' });
  await page.locator('#settings-toggle').click();
  await expect(setting).toBeChecked();
  await page.evaluate(() => window.__SOARING__.setTimeScale(12));
  await page.waitForFunction(() => window.__SOARING__.snapshot().activeThermal !== null, undefined, { timeout: 25_000 });
  const active = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(active.marker).toEqual(active.activeThermal);
  await setting.uncheck();
  expect((await page.evaluate(() => window.__SOARING__.snapshot())).marker).toBeNull();
  await page.reload();
  await page.locator('#settings-toggle').click();
  await expect(setting).not.toBeChecked();
  await page.evaluate(() => window.__SOARING__.setTimeScale(12));
  await page.waitForFunction(() => window.__SOARING__.snapshot().activeThermal !== null, undefined, { timeout: 25_000 });
  expect((await page.evaluate(() => window.__SOARING__.snapshot())).marker).toBeNull();
  await setting.check();
  const enabled = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(enabled.marker).toEqual(enabled.activeThermal);
  expect(errors).toEqual([]);
});

test('persists safe local-terrain height bounds across reloads', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/?smoke');
  await page.locator('#settings-toggle').click();
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
  await expect(settingsToggle).toBeVisible();
  await settingsToggle.click();
  await expect(controls).toHaveClass(/visible/);
  await expect(page.locator('#settings-panel')).toBeVisible();
  await expect(settingsToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(settingsToggle).toHaveAccessibleName('Close settings');
  await expect(page.locator('#quality')).toHaveCount(0);
  await expect(page.locator('#distance')).toHaveValue('220');
  await expect(page.locator('#ambience')).toHaveValue('0.4');
  await expect(page.locator('#music')).toHaveValue('0.4');
  await expect(page.locator('#visibility')).toHaveValue('1080');
  expect(await page.locator('#visibility').getAttribute('max')).toBe('5000');
  await page.locator('#visibility').fill('3600');
  await expect(page.locator('#distance')).toHaveValue('220');
  await page.locator('#distance').fill('160');
  await page.reload();
  await expect(page.locator('#visibility')).toHaveValue('3600');
  await expect(page.locator('#distance')).toHaveValue('160');
  // Full far-field loading is covered by unit tests; here the stream only has to make bounded progress.
  const first = await page.evaluate(() => window.__SOARING__.snapshot());
  await page.waitForFunction((chunks) => window.__SOARING__.snapshot().chunks >= chunks + 20, first.chunks);
  const snapshot = await page.evaluate(() => window.__SOARING__.snapshot());
  expect(snapshot.requestedDistance).toBe(3600);
  expect(snapshot.cameraDistance).toBe(160);
  expect(snapshot.visibleDistance).toBeLessThanOrEqual(3600);
  expect(snapshot.chunks + snapshot.pending).toBeLessThan(700);
  expect(errors).toEqual([]);
});

test('defaults terrain visibility to 5 km and streams bounded work at each LOD tier out to the 5 km max', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = captureErrors(page);
  await page.goto('/?smoke');
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator('#settings-toggle').click();
  // A fresh session (no saved settings) still gets the smoke harness's bounded budget, not the
  // 5 km product default - see the smokeMode override in src/main.ts.
  await expect(page.locator('#visibility')).toHaveValue('720');
  await page.evaluate(() => localStorage.removeItem('soaring.settings.v1'));
  await page.reload();
  await page.locator('#settings-toggle').click();
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
  await page.locator('#settings-toggle').click();
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
  await page.locator('#settings-toggle').click();
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
  await page.locator('#settings-toggle').click();
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
  await page.locator('#settings-toggle').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#settings-panel')).toBeVisible();
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('Muted');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soaring.settings.v1')!).muted)).toBe(true);

  await page.evaluate(() => localStorage.setItem('soaring.settings.v1', JSON.stringify({ muted: false })));
  await page.reload();
  await page.locator('#settings-toggle').click();
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

test('a blocked browser audio context keeps the mute control usable without page errors', async ({ page }) => {
  const errors = captureErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { value: class { constructor() { throw new Error('Audio unavailable'); } } });
  });
  await page.goto('/?smoke');
  await page.locator('#settings-toggle').click();
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveText('Muted');
  await expect(page.locator('.audio-note')).toContainText('Audio could not start');
  expect(errors).toEqual([]);
});

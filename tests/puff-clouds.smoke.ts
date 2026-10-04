import { expect, test } from '@playwright/test';

type PuffPlacement = { x: number; y: number; z: number; opacity: number };
type PuffLayout = { offsetX: number; offsetZ: number; height: number; width: number; driftSpeed: number };
type CloudSnapshot = {
  count: number;
  layout: PuffLayout[];
  placements: PuffPlacement[];
};
type CloudHarness = {
  snapshot: () => ReturnType<typeof window.__SOARING__.snapshot> & { drawCalls: number };
  puffCloudSnapshot: () => CloudSnapshot;
  reviewFlight: NonNullable<typeof window.__SOARING__.reviewFlight>;
  pauseFlight: () => void;
  setTimeOfDay: (phase: number) => void;
  setPuffCloudsVisible: (visible: boolean) => void;
};

test('keeps forty seeded puffs, drifts and wraps them, and adds one draw call', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('soaring.world-seed.v1', '5'));
  await page.goto('/?smoke');
  await page.evaluate(() => {
    const api = window.__SOARING__ as unknown as CloudHarness;
    const state = api.snapshot();
    // Puff bodies fade in with camera height and fade out under the deck from
    // above. Hold the bird just below the deck so the puff mesh is in the frame.
    api.reviewFlight({ x: state.position[0]!, y: 450, z: state.position[2]!, heading: state.heading });
    api.setTimeOfDay(0.5);
  });
  await page.waitForFunction(() => {
    const state = window.__SOARING__?.snapshot();
    return state !== undefined && state.chunks > 0 && state.pending === 0;
  }, undefined, { timeout: 120_000 });
  const settledFrame = await page.evaluate(() => window.__SOARING__.snapshot().renderedFrames);
  await page.waitForFunction((frame) => {
    const state = window.__SOARING__.snapshot();
    return state.renderedFrames >= frame + 4 && state.chunks > 0 && state.pending === 0;
  }, settledFrame);

  const initial = await page.evaluate(() => {
    const api = window.__SOARING__ as unknown as CloudHarness;
    return { ...api.snapshot(), puffClouds: api.puffCloudSnapshot() };
  });
  expect(initial.puffClouds.count).toBe(40);
  expect(initial.puffClouds.layout).toHaveLength(40);
  expect(initial.puffClouds.placements).toHaveLength(40);
  expect(initial.puffClouds.layout.every((puff) => puff.height >= 555 && puff.height <= 645)).toBe(true);
  expect(initial.puffClouds.layout.every((puff) => puff.width >= 55 && puff.width <= 150)).toBe(true);
  expect(initial.puffClouds.layout.every((puff) => puff.driftSpeed >= 2.4 && puff.driftSpeed <= 5.6)).toBe(true);
  await page.keyboard.press('d');
  await expect(page.locator('#diagnostics')).toContainText('puff clouds  40 instances · 1 draw call');

  const beforeHide = await page.evaluate(() => {
    const api = window.__SOARING__ as unknown as CloudHarness;
    api.setPuffCloudsVisible(false);
    return api.snapshot().renderedFrames;
  });
  await page.waitForFunction((frames) => window.__SOARING__.snapshot().renderedFrames > frames, beforeHide);
  const withoutPuffs = await page.evaluate(() => (window.__SOARING__ as unknown as CloudHarness).snapshot().drawCalls);
  const beforeShow = await page.evaluate(() => {
    const api = window.__SOARING__ as unknown as CloudHarness;
    api.setPuffCloudsVisible(true);
    return api.snapshot().renderedFrames;
  });
  await page.waitForFunction((frames) => window.__SOARING__.snapshot().renderedFrames > frames, beforeShow);
  const withPuffs = await page.evaluate(() => (window.__SOARING__ as unknown as CloudHarness).snapshot().drawCalls);
  expect(withPuffs).toBe(withoutPuffs + 1);

  // Paused flight now pauses cloud motion too. Resume before measuring drift.
  await page.evaluate(() => window.__SOARING__.reviewFlight!(null));
  await page.waitForTimeout(1800);
  const drifted = await page.evaluate(() => {
    const api = window.__SOARING__ as unknown as CloudHarness;
    return { ...api.snapshot(), puffClouds: api.puffCloudSnapshot() };
  });
  expect(Math.hypot(drifted.puffClouds.placements[0]!.x - initial.puffClouds.placements[0]!.x,
    drifted.puffClouds.placements[0]!.z - initial.puffClouds.placements[0]!.z)).toBeGreaterThan(1);

  const seedLayout = drifted.puffClouds.layout;
  await page.reload();
  await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0, undefined, { timeout: 120_000 });
  const repeated = await page.evaluate(() => (window.__SOARING__ as unknown as CloudHarness).puffCloudSnapshot().layout);
  expect(repeated).toEqual(seedLayout);

  await page.evaluate(() => {
    const api = window.__SOARING__ as unknown as CloudHarness;
    const state = api.snapshot();
    api.reviewFlight({ x: state.position[0]! + 5000, z: state.position[2]! - 5000, heading: state.heading });
  });
  await page.waitForFunction(() => {
    const api = window.__SOARING__ as unknown as CloudHarness;
    const state = api.snapshot();
    const placements = api.puffCloudSnapshot().placements;
    return placements.length === 40
      && placements.every((puff) => Math.abs(puff.x - state.position[0]!) <= 3200
        && Math.abs(puff.z - state.position[2]!) <= 3200);
  });
});

test('captures the puff deck from low, mid, and high chase flights at noon and golden hour', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '5');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
    const query = new URL(location.href).searchParams;
    const range = query.get('flight') === 'low' ? [50, 80]
      : query.get('flight') === 'mid' ? [230, 260] : [470, 500];
    localStorage.setItem('soaring.settings.v1', JSON.stringify({
      ambienceVolume: 0.52, musicVolume: 0.52, muted: true, lowPower: false,
      cameraDistance: 100, terrainVisibility: 720, showThermal: false,
      minFlightHeight: range[0], maxFlightHeight: range[1],
    }));
  });

  for (const flight of ['low', 'mid', 'high'] as const) {
    // Both times of day share one held pose and its terrain, so load each flight once.
    // A software renderer streams terrain slowly, and a reload per capture costs a full cold load.
    await page.goto(`/?smoke&profile&flight=${flight}`);
    await page.evaluate(() => window.__SOARING__.pauseFlight());
    await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0, undefined, { timeout: 120_000 });
    await page.evaluate(() => window.__SOARING__.setCapturePixelRatio(1));
    for (const [phase, time] of [[0.5, 'noon'], [0.72, 'golden-hour']] as const) {
      const previous = await page.evaluate((phase) => {
        const { renderedFrames, fog } = window.__SOARING__.snapshot();
        window.__SOARING__.setTimeOfDay(phase);
        document.querySelector('#intro')?.remove();
        document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
        return { renderedFrames, fogSamples: fog.samples };
      }, phase);
      // The haze must match this time of day, not the one shown before it.
      await page.waitForFunction(({ phase, previous }) => {
        const state = window.__SOARING__.snapshot();
        const clouds = (window.__SOARING__ as unknown as CloudHarness).puffCloudSnapshot();
        const fogGap = Math.hypot(...state.fog.color.map((value, index) => value - state.fog.targetColor[index]!));
        return state.renderedFrames > previous.renderedFrames && Math.abs(state.timeOfDay - phase) < 0.001
          && clouds.count === 40 && state.fog.samples > previous.fogSamples && fogGap < 0.01;
      }, { phase, previous });
      const sunElevation = await page.evaluate(() => window.__SOARING__.snapshot().sunElevation);
      expect(sunElevation).toBeGreaterThan(0);
      if (time === 'golden-hour') expect(sunElevation).toBeLessThan(0.3);
      const name = `puff-clouds-${flight}-${time}`;
      const screenshot = await page.screenshot({ path: `test-results/${name}.png` });
      await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
    }
  }
});

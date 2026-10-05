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
  await expect(page.locator('#diagnostics')).toContainText('puff clouds  40 clouds · 1200 sprites · 1 draw call');

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

test('frames one cumulus close up from its sunny side at noon and golden hour', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '5');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
  });
  await page.goto('/?smoke&profile');
  await page.evaluate(() => {
    const api = window.__SOARING__;
    const state = api.snapshot();
    // A 470 m camera sits inside the puff band, below the deck's whiteout.
    api.reviewFlight!({ x: state.position[0]!, y: 470 - 178 * 0.31 / 3, z: state.position[2]!, heading: state.heading });
    document.querySelector('#intro')?.remove();
    document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
    document.querySelector<HTMLElement>('.minimap')!.style.visibility = 'hidden';
  });
  await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0, undefined, { timeout: 120_000 });

  for (const [phase, time] of [[0.5, 'noon'], [0.715, 'golden-hour']] as const) {
    const start = await page.evaluate((phase) => {
      const api = window.__SOARING__;
      const { renderedFrames, fog } = api.snapshot();
      api.setTimeOfDay(phase);
      return { renderedFrames, samples: fog.samples };
    }, phase);
    await page.waitForFunction((start) => {
      const state = window.__SOARING__.snapshot();
      return state.renderedFrames > start.renderedFrames && state.fog.samples > start.samples && state.pending === 0
        && Math.hypot(...state.fog.color.map((value, index) => value - state.fog.targetColor[index]!)) < 1e-3;
    }, start, { timeout: 120_000 });
    // Stand 260 m from the widest nearby puff, 40 degrees off the sun's azimuth, looking up at its body.
    const puff = await page.evaluate(() => {
      const api = window.__SOARING__ as unknown as CloudHarness & { setViewpoint: (pose: object) => void };
      const state = api.snapshot();
      const { layout, placements } = api.puffCloudSnapshot();
      const near = placements.map((placement, index) => ({ ...placement, width: layout[index]!.width }))
        .filter((puff) => Math.hypot(puff.x - state.position[0]!, puff.z - state.position[2]!) < 1500)
        .sort((a, b) => b.width - a.width)[0]!;
      const sun = state.sunDirection;
      const azimuth = Math.atan2(sun[0]!, sun[2]!) + 40 * Math.PI / 180;
      const dx = Math.sin(azimuth), dz = Math.cos(azimuth);
      api.setViewpoint({ x: near.x + dx * 260, y: 470, z: near.z + dz * 260, lookX: near.x, lookY: near.y - 20, lookZ: near.z });
      return near;
    });
    const shot = async (visible: boolean) => {
      const frame = await page.evaluate((visible) => {
        (window.__SOARING__ as unknown as CloudHarness).setPuffCloudsVisible(visible);
        window.__SOARING__.setCapturePixelRatio(1);
        return window.__SOARING__.snapshot().renderedFrames;
      }, visible);
      await page.waitForFunction((frame) => window.__SOARING__.snapshot().renderedFrames > frame + 8, frame);
      return page.screenshot({ path: `test-results/puff-clouds-close-${time}${visible ? '' : '-no-puffs'}.png` });
    };
    const withPuffs = await shot(true);
    const withoutPuffs = await shot(false);
    await page.evaluate(() => (window.__SOARING__ as unknown as CloudHarness).setPuffCloudsVisible(true));
    await testInfo.attach(`puff-clouds-close-${time}`, { body: withPuffs, contentType: 'image/png' });
    const changed = await page.evaluate(async ([a, b]) => {
      const read = async (data: string) => {
        const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
        const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const p = await read(a!), q = await read(b!);
      let count = 0;
      for (let i = 0; i < p.length; i += 4) {
        if (Math.max(Math.abs(p[i]! - q[i]!), Math.abs(p[i + 1]! - q[i + 1]!), Math.abs(p[i + 2]! - q[i + 2]!)) > 6) count += 1;
      }
      return count;
    }, [withPuffs.toString('base64'), withoutPuffs.toString('base64')]);
    // A cloud at least 55 m wide, 260 m away, covers tens of thousands of pixels.
    expect(puff.opacity).toBeGreaterThan(0.5);
    expect(changed).toBeGreaterThan(20_000);
  }
});

test('captures the puff deck from low, mid, and high chase flights at noon and golden hour', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '5');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
    localStorage.setItem('soaring.settings.v1', JSON.stringify({
      ambienceVolume: 0.52, musicVolume: 0.52, muted: true,
      cameraDistance: 100, terrainVisibility: 720, showThermal: false,
    }));
  });

  for (const [flight, height] of [['low', 80], ['mid', 230], ['high', 470]] as const) {
    // The paused flight keeps one view, so noon and golden hour share a load: the slow
    // software renderer in CI spends most of this test streaming terrain.
    await page.goto('/?smoke&profile');
    await page.evaluate((height) => {
      const api = window.__SOARING__;
      const { position, heading } = api.snapshot();
      api.reviewFlight!({ x: position[0]!, y: api.sample(position[0]!, position[2]!).height + height, z: position[2]!, heading });
      api.pauseFlight();
    }, height);
    await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0, undefined, { timeout: 120_000 });
    await page.evaluate(() => {
      window.__SOARING__.setCapturePixelRatio(1);
      document.querySelector('#intro')?.remove();
      document.querySelector<HTMLElement>('#controls')!.style.visibility = 'hidden';
      document.querySelector<HTMLElement>('.minimap')!.style.visibility = 'hidden';
    });
    for (const [phase, time] of [[0.5, 'noon'], [0.72, 'golden-hour']] as const) {
      const start = await page.evaluate((phase) => {
        const { samples } = window.__SOARING__.snapshot().fog;
        const previousFrame = window.__SOARING__.snapshot().renderedFrames;
        window.__SOARING__.setTimeOfDay(phase);
        return { samples, previousFrame, revision: window.__SOARING__.fogSamples!().revision };
      }, phase);
      // Without a reload the haze eases from the last time of day, so wait until it reaches the new sky.
      await page.waitForFunction(({ phase, previousFrame, samples, revision }) => {
        const state = window.__SOARING__.snapshot();
        const clouds = (window.__SOARING__ as unknown as CloudHarness).puffCloudSnapshot();
        const completion = window.__SOARING__.fogSamples!().completion;
        return state.renderedFrames > previousFrame && Math.abs(state.timeOfDay - phase) < 0.001
          && state.pending === 0 && clouds.count === 40
          && !!completion && completion.revision === revision && completion.samples > samples
          && Math.hypot(...state.fog.color.map((value, index) => value - state.fog.targetColor[index]!)) < 0.01;
      }, { phase, previousFrame: start.previousFrame, samples: start.samples, revision: start.revision });
      const sunElevation = await page.evaluate(() => window.__SOARING__.snapshot().sunElevation);
      expect(sunElevation).toBeGreaterThan(0);
      if (time === 'golden-hour') expect(sunElevation).toBeLessThan(0.3);
      const name = `puff-clouds-${flight}-${time}`;
      const screenshot = await page.screenshot({ path: `test-results/${name}.png` });
      await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
    }
  }
});

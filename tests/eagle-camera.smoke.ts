import { expect, test } from '@playwright/test';

// Real pointer input, real chase camera, and real water samples.
test('the eagle stays at the orbit pivot and clearance uses the visible surface', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('soaring.world-seed.v1', '42'));
  await page.goto('/?smoke');
  await page.waitForFunction(() => Boolean(window.__SOARING__));
  const spots = await page.evaluate(() => {
    const api = window.__SOARING__;
    const lake = api.reviewSpots().lake;
    let wet: { x: number; z: number; surface: number } | undefined;
    let dry: { x: number; z: number; surface: number } | undefined;
    for (let dx = -2000; dx <= 2000 && (!wet || !dry); dx += 100) {
      for (let dz = -2000; dz <= 2000; dz += 100) {
        const x = lake.x + dx, z = lake.z + dz, sample = api.sample(x, z);
        if (sample.water && sample.surface - sample.height > 5) wet = { x, z, surface: sample.surface };
        if (!sample.water) dry = { x, z, surface: sample.height };
      }
    }
    if (!wet || !dry) throw new Error('Need submerged seabed and dry land');
    return [wet, dry];
  });
  const dimensions = await page.evaluate(async () => {
    const modulePath = '/src/eagle.ts';
    const { EagleView } = await import(modulePath);
    const view = new EagleView();
    const mesh = view.group.children[0];
    mesh.geometry.computeBoundingBox();
    const span = (mesh.geometry.boundingBox.max.x - mesh.geometry.boundingBox.min.x) * view.group.scale.x;
    mesh.geometry.dispose();
    mesh.material.dispose();
    return { span, distance: window.__SOARING__.snapshot().cameraDistance };
  });
  expect(dimensions.span).toBeGreaterThan(2);
  expect(dimensions.span).toBeLessThan(2.2);
  expect(dimensions.distance).toBe(16);
  const evidence: unknown[] = [dimensions];
  for (const [index, spot] of spots.entries()) {
    await page.evaluate((pose) => {
      window.__SOARING__.reviewFlight!({ ...pose, y: pose.surface + 57, heading: 0 });
    }, spot);
    await page.keyboard.press('d');
    await expect(page.locator('#diagnostics')).toContainText('clearance    57 m');
    await page.keyboard.press('d');
    await page.waitForFunction(() => Math.hypot(...window.__SOARING__.birdScreen()) < 0.001);
    const before = await page.evaluate(() => window.__SOARING__.birdScreen());
    await page.mouse.move(100, 350);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      const frame = await page.evaluate(() => window.__SOARING__.snapshot().renderedFrames);
      await page.mouse.move(100 + step * 105, 350 + step * 8);
      await page.waitForFunction((previous) => window.__SOARING__.snapshot().renderedFrames > previous, frame);
      const point = await page.evaluate(() => window.__SOARING__.birdScreen());
      evidence.push({ spot, step, point });
      expect(Math.hypot(point[0]! - before[0]!, point[1]! - before[1]!)).toBeLessThan(0.01);
    }
    await page.mouse.up();
    const screenshot = await page.screenshot({ path: testInfo.outputPath(`orbit-${index === 0 ? 'water' : 'land'}.png`) });
    await testInfo.attach(index === 0 ? 'orbit-water' : 'orbit-land', { body: screenshot, contentType: 'image/png' });
  }
  // Repeat at the surface so the camera ground clamp is active.
  await page.evaluate((spot) => window.__SOARING__.reviewFlight!({ ...spot, y: spot.surface + 0.5, heading: 0 }), spots[0]!);
  await page.waitForFunction(() => Math.hypot(...window.__SOARING__.birdScreen()) < 0.001);
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(750, 100, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__SOARING__.snapshot().orbitPitch < -0.5);
  const clamped = await page.evaluate(() => window.__SOARING__.birdScreen());
  expect(Math.hypot(...clamped)).toBeLessThan(0.01);
  expect(await page.evaluate(() => window.__SOARING__.snapshot().cameraHeight)).toBeGreaterThanOrEqual(0.799);
  evidence.push({ clamped });
  await testInfo.attach('orbit-projection', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

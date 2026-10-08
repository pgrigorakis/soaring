import { expect, test } from '@playwright/test';

// UI seam: real navigation review poses, visible compass ticks, accessible bearing/height,
// and the existing pointer/nudge/map controls. Save repeatable screenshots and a bearing trace.
// Failure cases: +z mistaken for north; inverted east/west; long rotation at north;
// height measured from seabed; whole-degree tick jumps; phone crowding; overlay overlap.
test('the field compass follows the eagle and shows flight height above land and water', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('soaring.world-seed.v1', '42');
    localStorage.setItem('soaring.scenic-visit.v1', '0');
  });
  await page.goto('/?smoke');
  const hud = page.getByRole('region', { name: 'Flight height and bearing' });
  await expect(hud).toBeVisible();
  const spots = await page.evaluate(() => {
    const api = window.__SOARING__, lake = api.reviewSpots().lake;
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
    return { wet, dry };
  });
  const evidence: unknown[] = [];
  for (const [label, spot] of Object.entries(spots)) {
    await page.evaluate((pose) => window.__SOARING__.reviewFlight!({ ...pose, y: pose.surface + 57, heading: 0 }), spot);
    await expect(hud.getByLabel('Flight height', { exact: true })).toHaveText('57 m');
    await expect(hud.getByLabel('Eagle bearing')).toHaveText('180°');
    await page.keyboard.press('d');
    await expect(page.locator('#diagnostics')).toContainText('clearance    57 m');
    await page.keyboard.press('d');
    evidence.push({ label, spot, height: await hud.getByLabel('Flight height', { exact: true }).textContent() });
  }

  // Worked map convention: heading 0 points south; positive pi/2 points east.
  const headings = [Math.PI, 3 * Math.PI / 4, Math.PI / 2, Math.PI / 4, 0, -Math.PI / 4, -Math.PI / 2, -3 * Math.PI / 4];
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (const [index, heading] of headings.entries()) {
    await page.evaluate(({ pose, heading }) => window.__SOARING__.reviewFlight!({ ...pose, y: pose.surface + 57, heading }), { pose: spots.dry, heading });
    await expect(hud.getByLabel('Eagle bearing')).toHaveText(`${String(index * 45).padStart(3, '0')}°`);
    await expect.poll(() => hud.locator('svg').evaluate((svg, cardinal) => {
      const text = [...svg.querySelectorAll('text')].find((node) => node.textContent === cardinal)!;
      const group = text.parentNode as SVGGElement;
      return Math.abs(group.getCTM()!.e - svg.clientWidth / 2);
    }, cardinals[index]!)).toBeLessThan(2);
    evidence.push({ cardinal: cardinals[index], heading });
  }

  // A narrow change through north must not turn the tape all the way around.
  await page.evaluate((pose) => window.__SOARING__.reviewFlight!({ ...pose, y: pose.surface + 57, heading: -179 * Math.PI / 180 }), spots.dry);
  await expect(hud.getByLabel('Eagle bearing')).toHaveText('359°');
  await page.waitForTimeout(700);
  const trace = await page.evaluate(async (pose) => {
    window.__SOARING__.reviewFlight!({ ...pose, y: pose.surface + 57, heading: 179 * Math.PI / 180 });
    const frames: { bearing: number; tickX: number }[] = [];
    for (let index = 0; index < 40; index++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const hud = document.querySelector<HTMLElement>('.flight-hud')!;
      const text = [...hud.querySelectorAll('svg text')].find((node) => node.textContent === 'N')!;
      const group = text.parentNode as SVGGElement;
      frames.push({ bearing: Number(hud.dataset.bearing), tickX: group.getCTM()!.e });
    }
    return frames;
  }, spots.dry);
  for (const [index, frame] of trace.slice(1).entries()) {
    const previous = trace[index]!;
    const step = (frame.bearing - previous.bearing + 540) % 360 - 180;
    expect(step).toBeGreaterThanOrEqual(-0.001);
    // Slow CI frames may cover the whole 2° input, but never a long rotation or a 5° tick jump.
    expect(step).toBeLessThan(2.01);
    expect(Math.abs(frame.tickX - previous.tickX)).toBeLessThan(7.3);
  }
  await expect(hud.getByLabel('Eagle bearing')).toHaveText('001°');
  evidence.push({ northCrossing: trace });

  // Orbit changes the view, not the eagle bearing.
  await page.mouse.move(300, 350);
  await page.mouse.down();
  await page.mouse.move(650, 370, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__SOARING__.snapshot().orbitYaw)).not.toBe(0);
  await expect(hud.getByLabel('Eagle bearing')).toHaveText('001°');

  await page.keyboard.down('ArrowLeft');
  await page.evaluate(() => window.__SOARING__.advanceSimulation!(0.2));
  await expect(page.locator('#nudge-hint')).toHaveClass(/visible/);
  const hudBox = (await hud.boundingBox())!, hintBox = (await page.locator('#nudge-hint').boundingBox())!;
  expect(hudBox.y + hudBox.height).toBeLessThan(hintBox.y);
  await page.keyboard.up('ArrowLeft');
  await page.screenshot({ path: testInfo.outputPath('field-compass-nudge.png') });

  await page.keyboard.press('m');
  await expect(page.locator('.map-panel')).toHaveClass(/open/);
  expect(await hud.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return Boolean(document.elementFromPoint(rect.x + rect.width / 2, rect.y + 20)?.closest('.map-panel'));
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('field-compass-map.png') });
  await page.keyboard.press('m');

  for (const width of [390, 2560]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1440 });
    await expect.poll(() => hud.evaluate((element) => element.getBoundingClientRect().width / innerWidth)).toBeGreaterThanOrEqual(.249);
    expect(await hud.evaluate((element) => element.getBoundingClientRect().width / innerWidth)).toBeLessThanOrEqual(.334);
    expect(await hud.getByLabel('Flight height', { exact: true }).evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(19);
    expect(await hud.locator('svg').evaluate((element) => parseFloat(getComputedStyle(element.querySelector('text')!).fontSize))).toBeGreaterThanOrEqual(14);
    await page.screenshot({ path: testInfo.outputPath(`field-compass-${width}.png`) });
  }
  await testInfo.attach('field-compass-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });

  // A held view should not spend its frame budget rewriting an unchanged instrument.
  await page.evaluate(() => {
    const api = window.__SOARING__, state = api.snapshot();
    api.reviewFlight!({ x: state.position[0]!, y: state.position[1]!, z: state.position[2]!, heading: Math.PI / 2 });
  });
  await expect(hud.getByLabel('Eagle bearing')).toHaveText('090°');
  // Wait for easing to finish, not a fixed wall-clock delay on a slow software renderer.
  await expect.poll(() => hud.evaluate((element) => Number((element as HTMLElement).dataset.bearing)), { timeout: 20_000 }).toBe(90);
  const writes = await hud.evaluate(async (element) => {
    let writes = 0;
    const observer = new MutationObserver((records) => { writes += records.length; });
    observer.observe(element, { attributes: true, childList: true, characterData: true, subtree: true });
    for (let frame = 0; frame < 20; frame++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    writes += observer.takeRecords().length;
    observer.disconnect();
    return writes;
  });
  await testInfo.attach('held-hud-writes', { body: JSON.stringify({ frames: 20, writes }), contentType: 'application/json' });
  expect(writes).toBe(0);

  await hud.evaluate((element) => {
    let writes = 0;
    const observer = new MutationObserver((records) => { writes += records.length; });
    observer.observe(element, { attributes: true, childList: true, characterData: true, subtree: true });
    (element as HTMLElement & { finishResizeAudit: () => number }).finishResizeAudit = () => {
      writes += observer.takeRecords().length;
      observer.disconnect();
      return writes;
    };
  });
  const cdp = await page.context().newCDPSession(page);
  const metrics = [
    { width: 1000, height: 700, deviceScaleFactor: 2 },
    { width: 1512, height: 982, deviceScaleFactor: 2 },
    { width: 1512, height: 982, deviceScaleFactor: 1 },
    { width: 390, height: 844, deviceScaleFactor: 1 },
    { width: 790, height: 844, deviceScaleFactor: 1 },
    { width: 800, height: 844, deviceScaleFactor: 1 },
  ];
  for (const metric of metrics) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...metric, mobile: false });
    await expect.poll(() => hud.locator('svg').evaluate((svg) => {
      const text = [...svg.querySelectorAll('text')].find((node) => node.textContent === 'E')!;
      return Math.abs((text.parentNode as SVGGElement).getCTM()!.e - svg.clientWidth / 2);
    })).toBeLessThan(2);
    await expect.poll(() => hud.locator('svg').evaluate((svg) => {
      const lines = [...svg.querySelectorAll('line')];
      const spacing = (lines[1]!.parentNode as SVGGElement).getCTM()!.e - (lines[0]!.parentNode as SVGGElement).getCTM()!.e;
      const width = svg.getBoundingClientRect().width;
      return Math.abs(spacing - (width < 240 ? 11 : width / 24));
    })).toBeLessThan(0.05);
  }
  const resizeWrites = await hud.evaluate((element) => (element as HTMLElement & { finishResizeAudit: () => number }).finishResizeAudit());
  await testInfo.attach('hud-resize-writes', { body: JSON.stringify({ metrics, writes: resizeWrites }), contentType: 'application/json' });
  expect(resizeWrites).toBe(0);
  await cdp.detach();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => hud.locator('svg').evaluate((svg) => {
    const text = [...svg.querySelectorAll('text')].find((node) => node.textContent === 'E')!;
    const group = text.parentNode as SVGGElement;
    return Math.abs(group.getCTM()!.e - svg.clientWidth / 2);
  })).toBeLessThan(2);
  await expect(hud.getByLabel('Eagle bearing')).toHaveText('090°');
  await hud.screenshot({ path: testInfo.outputPath('held-field-compass-resize.png') });
  expect(errors).toEqual([]);
});

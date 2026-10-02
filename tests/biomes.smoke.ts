import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Failure modes: weights depend on cache/order, profile blending recurses through drainage,
// adjacent meshes disagree on colour/height, pool water floats above dry ground, or rendering fails.
test('renders blended biome terrain with deterministic shared chunk edges', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?smoke');
  await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0);
  const evidence = await page.evaluate(async () => {
    const worldPath = '/src/world.ts';
    const terrainPath = '/src/terrain.ts';
    const threePath = '/node_modules/.vite/deps/three.js';
    const { WorldModel } = await import(worldPath);
    const { TerrainStream, CHUNK_SIZE } = await import(terrainPath);
    const THREE = await import(threePath);
    const first = new WorldModel(80231);
    const second = new WorldModel(80231);
    const samples = [];
    for (let index = 0; index < 40; index += 1) {
      const x = Math.sin(index * 7.1) * 40000;
      const z = Math.cos(index * 3.3) * 40000;
      const a = first.sample(x, z);
      const b = second.sample(x, z);
      samples.push({ x, z, sample: a, deterministic: JSON.stringify(a) === JSON.stringify(b),
        sum: Object.values(a.biome).reduce((sum: number, weight) => sum + Number(weight), 0) });
    }
    const scene = new THREE.Scene();
    const terrain = new TerrainStream(scene, first);
    terrain.update(CHUNK_SIZE / 2, CHUNK_SIZE / 2, Infinity);
    const leftGroup = scene.getObjectByName('land 0,0');
    const rightGroup = scene.getObjectByName('land 1,0');
    const left = leftGroup.children[0].geometry;
    const right = rightGroup.children[0].geometry;
    const attributes = ['position', 'normal', 'color'];
    let seamError = 0;
    for (const name of attributes) {
      const a = left.getAttribute(name);
      const b = right.getAttribute(name);
      for (let row = 0; row <= 40; row += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          // Floating-origin chunks store local positions; compare the shared world edge.
          const leftOffset = name === 'position' ? leftGroup.position.getComponent(axis) : 0;
          const rightOffset = name === 'position' ? rightGroup.position.getComponent(axis) : 0;
          seamError = Math.max(seamError, Math.abs(a.array[(row * 41 + 40) * 3 + axis] + leftOffset
            - b.array[row * 41 * 3 + axis] - rightOffset));
        }
      }
    }
    const timing = terrain.buildTiming;
    terrain.dispose();
    return { samples, seamError, timing, app: window.__SOARING__.snapshot() };
  });
  for (const entry of evidence.samples) {
    expect(entry.deterministic).toBe(true);
    expect(entry.sum).toBeCloseTo(1, 12);
    expect(Object.values(entry.sample.biome).every((weight) => Number(weight) >= 0 && Number(weight) <= 1)).toBe(true);
  }
  expect(evidence.samples.some((entry) => entry.sample.biome.lakeland > 0.5)).toBe(true);
  expect(evidence.seamError).toBe(0);
  expect(errors).toEqual([]);
  await testInfo.attach('biome-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await testInfo.attach('biome-render', { body: await page.screenshot(), contentType: 'image/png' });
});

// Failure modes: parcels remain aligned squares, hedges remain painted stripes,
// negative coordinates change field ownership, or colour changes alter glade/density rules.
test('renders varied farmland with physical hedgerows', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('soaring.world-seed.v1', '80231'));
  await page.goto('/?smoke');
  await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0);
  const evidence = await page.evaluate(async () => {
    const worldPath = '/src/world.ts';
    const terrainPath = '/src/terrain.ts';
    const threePath = '/node_modules/.vite/deps/three.js';
    const { WorldModel, farmland } = await import(worldPath);
    const { TerrainStream } = await import(terrainPath);
    const THREE = await import(threePath);
    const fields = new Set();
    const angles = new Set();
    let deterministic = true;
    for (let z = -41000; z < -39000; z += 30) {
      for (let x = -9000; x < -7000; x += 30) {
        const field = farmland(x, z, 80231);
        deterministic &&= JSON.stringify(field) === JSON.stringify(farmland(x, z, 80231));
        fields.add(field.field);
        if (field.fieldEdge) angles.add(Math.round(field.fieldEdge.turn * 10));
      }
    }
    const scene = new THREE.Scene();
    const terrain = new TerrainStream(scene, new WorldModel(80231));
    terrain.update(-8000, -40000, Infinity);
    let hedgeInstances = 0;
    scene.traverse((object: any) => { if (object.name === 'hedgerows') hedgeInstances += object.count; });
    terrain.dispose();
    window.__SOARING__.setTimeOfDay(.5);
    window.__SOARING__.setViewpoint({ x: -8200, y: 290, z: -39500, lookX: -8000, lookY: 140, lookZ: -40300 });
    return { fields: fields.size, angles: angles.size, deterministic, hedgeInstances };
  });
  expect(evidence.deterministic).toBe(true);
  expect(evidence.fields).toBeGreaterThan(20);
  expect(evidence.angles).toBeGreaterThan(8);
  expect(evidence.hedgeInstances).toBeGreaterThan(30);
  await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0);
  const imagePath = testInfo.outputPath('farmland-render.png');
  const evidencePath = testInfo.outputPath('farmland-evidence.json');
  await page.screenshot({ path: imagePath });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach('farmland-evidence', { path: evidencePath, contentType: 'application/json' });
  await testInfo.attach('farmland-render', { path: imagePath, contentType: 'image/png' });
});

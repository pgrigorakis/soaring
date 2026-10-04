import { expect, test } from '@playwright/test';

// Failure modes: local water levels return, water interpolates a different
// diagonal from terrain, tier edges disagree, or shore targets/placements flood.
test('sea-level basins use terrain triangles and seamless water across tiers', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('soaring.world-seed.v1', '448122'));
  await page.goto('/?smoke');
  const evidence = await page.evaluate(async () => {
    const worldPath = '/src/world.ts',
      terrainPath = '/src/terrain.ts',
      threePath = '/node_modules/.vite/deps/three.js';
    const { WorldModel } = await import(worldPath),
      { TerrainStream } = await import(terrainPath),
      THREE = await import(threePath);
    const world = new WorldModel(448122),
      scene = new THREE.Scene(),
      terrain = new TerrainStream(scene, world),
      chunks: any[] = [];
    const make = (x: number, z: number, size: number, tier: string) => {
      const build = terrain.createChunk({ x, z, chunkSize: size, tier, trees: 'none' });
      let r = build.next();
      while (!r.done) r = build.next();
      chunks.push(r.value);
      return r.value.group;
    };
    let row = 0;
    for (let candidate = -8; candidate <= 8; candidate++) {
      if (Array.from({ length: 17 }, (_, i) => world.sample(1440, candidate * 1440 + i * 90).water).some(Boolean)) {
        row = candidate;
        break;
      }
    }
    const far = make(1, row, 1440, 'far');
    const edge = (group: any, localX: number) => {
      const result = new Map();
      const mesh = group.children.find((m: any) => m.material?.transparent);
      if (!mesh) return result;
      const p = mesh.geometry.getAttribute('position'),
        c = mesh.geometry.getAttribute('color'),
        d = mesh.geometry.getAttribute('waterDepth');
      for (let i = 0; i < p.count; i++) {
        const wx = p.getX(i) + group.position.x,
          wz = p.getZ(i) + group.position.z,
          s = world.sample(wx, wz);
        if (Math.abs(d.getX(i) + s.height) > 0.0001) throw new Error('Water depth does not match terrain vertex');
        if (p.getY(i) !== 0) throw new Error('Local water level');
        if (p.getX(i) === localX) result.set(wz, [p.getY(i), c.getX(i), c.getY(i), c.getZ(i), d.getX(i)]);
      }
      return result;
    };
    const farEdge = edge(far, 0);
    let seamError = 0,
      sharedVertices = 0;
    for (let j = row * 4; j < row * 4 + 4; j++) {
      const mid = make(3, j, 360, 'mid'),
        near = make(4, j, 360, 'near');
      const left = edge(mid, 360),
        right = edge(near, 0);
      for (const [z, values] of left)
        for (const neighbor of [right.get(z), farEdge.get(z)])
          if (neighbor) {
            sharedVertices++;
            values.forEach((v: number, i: number) => (seamError = Math.max(seamError, Math.abs(v - neighbor[i]))));
          }
    }
    const lake = world.landmarkNear(0, 0),
      shore = world.nearestShore(lake.x, lake.z);
    const thermals = world.nearbyThermals(lake.x, lake.z, 3);
    const dryThermals = thermals.every((t: any) => !world.sample(t.x, t.z).water);
    const shoreHeight = shore ? world.sample(shore.x, shore.z).height : null;
    chunks.forEach((c) => c.dispose());
    terrain.dispose();
    window.__SOARING__.reviewFlight!({ x: lake.x, z: lake.z, heading: 0.4 });
    window.__SOARING__.setTimeOfDay(0.5);
    window.__SOARING__.setVisibility(720);
    return { seed: 448122, row, lake, shoreHeight, seamError, sharedVertices, dryThermals };
  });
  expect(evidence.sharedVertices).toBeGreaterThan(10);
  expect(evidence.seamError).toBe(0);
  expect(evidence.lake.surface).toBe(0);
  expect(Math.abs(evidence.shoreHeight!)).toBeLessThan(0.01);
  expect(evidence.dryThermals).toBe(true);
  expect(errors).toEqual([]);
  await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0);
  await testInfo.attach('lakeland-evidence', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('lakeland-render', { body: await page.screenshot(), contentType: 'image/png' });
});

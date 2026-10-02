import { expect, test } from '@playwright/test';

// Failure modes: water changes its grid at LOD boundaries, dry banks flood,
// islands lose their trees, thermals occupy the lake, or a long crossing stalls.
test('renders a long valley lake with a wooded island, beach and seamless water tiers', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('soaring.world-seed.v1', '448122'));
  await page.goto('/?smoke');
  await page.waitForFunction(() => window.__SOARING__?.snapshot().pending === 0);
  const evidence = await page.evaluate(async () => {
    const worldPath = '/src/world.ts';
    const terrainPath = '/src/terrain.ts';
    const threePath = '/node_modules/.vite/deps/three.js';
    const { WorldModel, lakeShorePoint } = await import(worldPath);
    const { TerrainStream } = await import(terrainPath);
    const THREE = await import(threePath);
    const world = new WorldModel(448122);
    const x = 7647.127558763605, z = -11252.509786414448;
    const lake = world.reachesNear(x, z).find((r: any) => r.ax === x && r.az === z && r.lake);
    const scene = new THREE.Scene();
    const terrain = new TerrainStream(scene, world);
    const chunks: any[] = [];
    const make = (cx: number, cz: number, size: number, tier: string) => {
      const chunk = terrain.createChunk({ x: cx, z: cz, chunkSize: size, tier, trees: 'none' });
      chunks.push(chunk);
      return chunk.group;
    };
    const far = make(5, -8, 1440, 'far');
    const edge = (group: any, localX: number) => {
      const result = new Map();
      const mesh = group.children.find((m: any) => m.material?.transparent);
      if (!mesh) return result;
      const positions = mesh.geometry.getAttribute('position');
      const colors = mesh.geometry.getAttribute('color');
      for (let index = 0; index < positions.count; index++) {
        if (positions.getX(index) !== localX) continue;
        const wx = positions.getX(index) + group.position.x;
        const wz = positions.getZ(index) + group.position.z;
        const sample = world.sample(wx, wz);
        const y = positions.getY(index);
        if (!sample.water && y > sample.height + .0001) throw new Error(`Flooded dry bank at ${wx},${wz}`);
        result.set(wz, [y, colors.getX(index), colors.getY(index), colors.getZ(index)]);
      }
      return result;
    };
    let seamError = 0, sharedVertices = 0;
    const farEdge = edge(far, 0);
    for (let row = -32; row < -28; row++) {
      const mid = make(19, row, 360, 'mid');
      const near = make(20, row, 360, 'near');
      const left = edge(mid, 360), right = edge(near, 0);
      for (const [wz, values] of left) {
        for (const neighbor of [right.get(wz), farEdge.get(wz)]) {
          if (!neighbor) continue;
          sharedVertices++;
          values.forEach((value: number, axis: number) => { seamError = Math.max(seamError, Math.abs(value - neighbor[axis])); });
        }
      }
    }
    const islandTrees = world.treesInArea(x - 180, z - 180, 360, 29).filter((tree: any) => world.sample(tree.x, tree.z).island);
    const ring = Array.from({ length: 32 }, (_, index) => {
      const angle = index * Math.PI / 16;
      return world.sample(x + Math.cos(angle) * (lake.islandRadius + 90), z + Math.sin(angle) * (lake.islandRadius + 90)).water;
    });
    // Main's accepted shore-following behavior must use the new ellipse outline.
    const shoreTargets = Array.from({ length: 32 }, (_, index) => lakeShorePoint(lake, index * Math.PI / 16, 60));
    const dryShoreTargets = shoreTargets.every((point: any) => !world.sample(point.x, point.z).water);
    const minorPoint = lakeShorePoint(lake, lake.heading + Math.PI / 2);
    const minorRadius = Math.hypot(minorPoint.x - x, minorPoint.z - z);
    const thermals = world.nearbyThermals(x, z, 3);
    const dryThermals = thermals.every((t: any) => !world.sample(t.x, t.z).water);
    // This seed's largest nominal basin is entirely removed by tributary protection.
    const maskedWorld = new WorldModel(-1214809889);
    const maskedLandmark = maskedWorld.landmarkNear(-147, -3730);
    const landmarkWater = !!maskedLandmark && maskedWorld.sample(maskedLandmark.x, maskedLandmark.z).water;
    chunks.forEach((chunk) => chunk.dispose());
    terrain.dispose();
    window.__SOARING__.setTimeOfDay(.5);
    window.__SOARING__.setViewpoint({ x: x - 1100, y: 630, z: z + 1300, lookX: x, lookY: 85, lookZ: z });
    return { seed: world.seed, lake, seamError, sharedVertices, islandTrees: islandTrees.length, waterRing: ring.filter(Boolean).length, dryThermals, landmarkWater, dryShoreTargets, minorRadius };
  });
  expect(evidence.sharedVertices).toBeGreaterThan(10);
  expect(evidence.seamError).toBe(0);
  expect(evidence.islandTrees).toBeGreaterThan(10);
  expect(evidence.waterRing).toBe(32);
  expect(evidence.dryThermals).toBe(true);
  expect(evidence.landmarkWater).toBe(true);
  expect(evidence.dryShoreTargets).toBe(true);
  expect(evidence.minorRadius).toBeLessThan(evidence.lake.aWidth * 0.35);
  expect(errors).toEqual([]);
  await page.waitForFunction(() => window.__SOARING__.snapshot().pending === 0);
  const rendered = await page.evaluate(() => window.__SOARING__.snapshot().renderedFrames);
  await page.waitForFunction((previous) => window.__SOARING__.snapshot().renderedFrames > previous, rendered);
  await testInfo.attach('lakeland-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await testInfo.attach('lakeland-render', { body: await page.screenshot(), contentType: 'image/png' });
});

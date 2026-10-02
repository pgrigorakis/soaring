// Run from the live dev app with chrome-devtools-axi eval:
// async () => (await import('/scripts/audit-biomes-browser.ts')).coverage()
// benchmark() requires the immutable baseline modules described in the diagnostic report.
import * as THREE from 'three';
import { WorldModel } from '../src/world';
import { TerrainStream } from '../src/terrain';

export function coverage() {
  const rows = [];
  for (const seed of [80231, 42, 123456]) {
    const world = new WorldModel(seed);
    const weights = { hills: 0, woodland: 0, moor: 0, highlands: 0, lakeland: 0 };
    let dry = 0;
    let water = 0;
    let n = 0;
    let maxSumError = 0;
    for (let z = -120000; z < 120000; z += 2500) {
      for (let x = -120000; x < 120000; x += 2500) {
        const sample = world.sample(x + 123.75, z - 231.5);
        maxSumError = Math.max(maxSumError, Math.abs(Object.values(sample.biome).reduce((a, b) => a + b, 0) - 1));
        if (sample.water) water += 1;
        else {
          dry += 1;
          for (const key of Object.keys(weights) as (keyof typeof weights)[]) weights[key] += sample.biome[key];
        }
        n += 1;
        if (n % 100 === 0) world.trim(20000);
      }
    }
    rows.push({ seed, dry, water, maxSumError, weights: Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / dry])) });
  }
  return { extentMeters: 240000, stepMeters: 2500, offset: [123.75, -231.5], rows };
}

export async function benchmark() {
  const worldPath = '/test-results/baseline/world.ts';
  const terrainPath = '/test-results/baseline/terrain.ts';
  const { WorldModel: BaselineWorld } = await import(worldPath);
  const { TerrainStream: BaselineTerrain } = await import(terrainPath);
  const spots = [[-8000, -40000], [-36000, -40000], [-40000, -40000], [11000, -40000]];
  const run = (World: typeof WorldModel, Terrain: typeof TerrainStream) => {
    const world = new World(80231);
    const terrain = new Terrain(new THREE.Scene(), world);
    let total = 0;
    let chunks = 0;
    let maxMs = 0;
    // Observe the same createChunk boundary as the production buildTiming diagnostic.
    const measured = terrain as unknown as { createChunk: (...args: unknown[]) => unknown };
    const original = measured.createChunk.bind(terrain);
    measured.createChunk = (...args) => {
      const start = performance.now();
      const chunk = original(...args);
      const ms = performance.now() - start;
      total += ms;
      chunks += 1;
      maxMs = Math.max(maxMs, ms);
      return chunk;
    };
    for (const [x, z] of spots) terrain.update(x!, z!, 25);
    terrain.dispose();
    return { chunks, meanMs: total / chunks, maxMs };
  };
  run(BaselineWorld, BaselineTerrain);
  run(WorldModel, TerrainStream);
  const rows = [];
  for (let index = 0; index < 5; index += 1) {
    const baselineFirst = index % 2 === 0;
    const a = run(baselineFirst ? BaselineWorld : WorldModel, baselineFirst ? BaselineTerrain : TerrainStream);
    const b = run(baselineFirst ? WorldModel : BaselineWorld, baselineFirst ? TerrainStream : BaselineTerrain);
    rows.push({ baseline: baselineFirst ? a : b, current: baselineFirst ? b : a });
  }
  const baselineMeanMs = rows.reduce((sum, row) => sum + row.baseline.meanMs, 0) / rows.length;
  const currentMeanMs = rows.reduce((sum, row) => sum + row.current.meanMs, 0) / rows.length;
  return { baselineRef: 'bb19112', spots, rows, baselineMeanMs, currentMeanMs, increasePercent: (currentMeanMs / baselineMeanMs - 1) * 100 };
}

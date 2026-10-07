// Measures the tree load of the densest Woodland rings to size the shared tree pools in src/terrain.ts.
// Run: node scripts/audit-tree-pools.mjs [seed ...]
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const outfile = 'test-results/tree-pool-world.mjs';
await build({ entryPoints: ['src/world.ts'], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const { WorldModel } = await import(`../${outfile}?${Date.now()}`);

// Mirrors TerrainStream.recenter: near trees inside 3 chunk gaps, then tree billboards on the rest
// of the fine grid, out to FAR_START (4320 m), both measured from the camera's chunk.
const CHUNK = 360, NEAR = 3 * CHUNK, CUTOFF = 4320, SPACING = 29, RADIUS = 12;
const offsets = [];
for (let dz = -RADIUS; dz <= RADIUS; dz += 1) {
  for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
    const gap = Math.hypot(Math.max(Math.abs(dx) - 1, 0), Math.max(Math.abs(dz) - 1, 0)) * CHUNK;
    if (gap <= NEAR) offsets.push({ dx, dz, near: true });
    else if (gap < CUTOFF) offsets.push({ dx, dz, near: false });
  }
}
const pools = ['midconifers', 'midbroadleaf', 'midbirch', 'conifers', 'broadleaf', 'birch'];
const seeds = process.argv.slice(2).map(Number);
if (seeds.length === 0) seeds.push(5, 80231, 448122, 1, 2, 3);

const report = { ring: { nearChunks: offsets.filter((o) => o.near).length, midChunks: offsets.filter((o) => !o.near).length },
  method: 'Coarse woodland scan, then exact per-chunk tree counts at the best centers and their 8 neighbors. '
    + 'The load is the steady ring and the union of two adjacent rings, which is what a one-chunk move holds before rebuilds finish.',
  seeds: [], max: Object.fromEntries(pools.map((pool) => [pool, { steady: 0, step: 0 }])) };

for (const seed of seeds) {
  const world = new WorldModel(seed);
  const counts = new Map();
  const chunk = (x, z) => {
    const key = `${x},${z}`;
    let value = counts.get(key);
    if (!value) {
      value = [0, 0, 0];
      for (const tree of world.treesInArea(x * CHUNK, z * CHUNK, CHUNK, SPACING)) value[tree.kind] += 1;
      counts.set(key, value);
    }
    return value;
  };
  // Pool load of one ring, keyed by chunk so two rings can be merged without double counting.
  const ring = (cx, cz) => {
    const tiles = new Map();
    for (const { dx, dz, near } of offsets) tiles.set(`${cx + dx},${cz + dz}`, { x: cx + dx, z: cz + dz, near });
    return tiles;
  };
  const load = (...rings) => {
    const near = new Set();
    const mid = new Set();
    const tiles = new Map();
    for (const tiles2 of rings) {
      for (const [key, tile] of tiles2) { (tile.near ? near : mid).add(key); tiles.set(key, tile); }
    }
    const total = Object.fromEntries(pools.map((pool) => [pool, 0]));
    for (const [key, tile] of tiles) {
      const [conifer, broadleaf, birch] = chunk(tile.x, tile.z);
      // A chunk that changed tier still holds its old trees, so a union counts both sets.
      // Each tree is one whole-tree instance or billboard in its kind's pool.
      if (near.has(key)) { total.conifers += conifer; total.broadleaf += broadleaf; total.birch += birch; }
      if (mid.has(key)) { total.midconifers += conifer; total.midbroadleaf += broadleaf; total.midbirch += birch; }
    }
    return total;
  };

  // Woodland weight sampled on a 1440 m lattice, averaged over the ring's footprint.
  const step = 4;
  const scan = [];
  for (let cz = -160; cz <= 160; cz += step) {
    for (let cx = -160; cx <= 160; cx += step) {
      let woodland = 0;
      for (let dz = -8; dz <= 8; dz += 4) for (let dx = -8; dx <= 8; dx += 4) woodland += world.sample((cx + dx + 0.5) * CHUNK, (cz + dz + 0.5) * CHUNK).biome.woodland;
      scan.push({ cx, cz, woodland: woodland / 25 });
    }
  }
  scan.sort((a, b) => b.woodland - a.woodland);
  const candidates = [];
  for (const spot of scan) {
    if (candidates.every((other) => Math.hypot(other.cx - spot.cx, other.cz - spot.cz) > 16)) candidates.push(spot);
    if (candidates.length === 4) break;
  }

  const best = Object.fromEntries(pools.map((pool) => [pool, { steady: 0, step: 0, at: null }]));
  for (const candidate of candidates) {
    // Refine on a 9x9 chunk neighborhood, then test each of the 8 one-chunk moves.
    for (let oz = -4; oz <= 4; oz += 1) {
      for (let ox = -4; ox <= 4; ox += 1) {
        const cx = candidate.cx + ox, cz = candidate.cz + oz;
        const here = ring(cx, cz);
        const steady = load(here);
        const stepped = Object.fromEntries(pools.map((pool) => [pool, steady[pool]]));
        for (const [mx, mz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const moved = load(here, ring(cx + mx, cz + mz));
          for (const pool of pools) stepped[pool] = Math.max(stepped[pool], moved[pool]);
        }
        for (const pool of pools) {
          if (steady[pool] > best[pool].steady) best[pool].at = [cx * CHUNK, cz * CHUNK];
          best[pool].steady = Math.max(best[pool].steady, steady[pool]);
          best[pool].step = Math.max(best[pool].step, stepped[pool]);
        }
      }
    }
  }
  for (const pool of pools) {
    report.max[pool].steady = Math.max(report.max[pool].steady, best[pool].steady);
    report.max[pool].step = Math.max(report.max[pool].step, best[pool].step);
  }
  report.seeds.push({ seed, candidates, best });
  console.log(seed, JSON.stringify(best));
}
await writeFile('test-results/tree-pool-capacity.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.max, null, 2));

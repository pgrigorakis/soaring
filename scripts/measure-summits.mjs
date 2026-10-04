// Pyramid summits per Highlands core, rendered apex height and far-grid apex loss.
// Repeat: node scripts/measure-summits.mjs [world-source] [report-path]
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
await build({
  entryPoints: [process.argv[2] ?? 'src/world.ts'],
  outfile: 'test-results/summits-world.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { SUMMIT, WorldModel, hash2 } = await import('../test-results/summits-world.mjs');

const CELL = SUMMIT.cell;
const SPAN = 96000;
const CORE = SUMMIT.core;
const CORE_GRID = 600;
const FAR_STEP = 90;

function meshHeight(world, x, z, step) {
  const x0 = Math.floor(x / step) * step;
  const z0 = Math.floor(z / step) * step;
  const tx = (x - x0) / step;
  const tz = (z - z0) / step;
  const h00 = world.sample(x0, z0).height;
  const h10 = world.sample(x0 + step, z0).height;
  const h01 = world.sample(x0, z0 + step).height;
  const h11 = world.sample(x0 + step, z0 + step).height;
  return tx + tz <= 1
    ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
    : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}

// Hill-climb from the candidate apex to the rendered top, on a shrinking step.
function apex(world, x, z) {
  let best = { x, z, height: world.sample(x, z).height };
  for (const step of [80, 40, 20, 10, 5]) {
    for (let pass = 0; pass < 40; pass += 1) {
      let moved = false;
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]]) {
        const height = world.sample(best.x + dx, best.z + dz).height;
        if (height > best.height + 0.01) {
          best = { x: best.x + dx, z: best.z + dz, height };
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  return best;
}

function measure(seed) {
  const world = new WorldModel(seed);
  // Cores: connected cells at or above the summit core threshold.
  const n = SPAN / CORE_GRID;
  const core = new Int32Array(n * n).fill(-1);
  const inside = new Uint8Array(n * n);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      inside[j * n + i] = world.mountainRegion((i + 0.5) * CORE_GRID - SPAN / 2, (j + 0.5) * CORE_GRID - SPAN / 2) >= CORE ? 1 : 0;
    }
  }
  const cores = [];
  for (let start = 0; start < n * n; start += 1) {
    if (!inside[start] || core[start] >= 0) continue;
    const id = cores.length;
    const stack = [start];
    core[start] = id;
    let cells = 0;
    let edge = false;
    while (stack.length > 0) {
      const k = stack.pop();
      cells += 1;
      const i = k % n;
      const j = Math.floor(k / n);
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) edge = true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const next = jj * n + ii;
        if (inside[next] && core[next] < 0) {
          core[next] = id;
          stack.push(next);
        }
      }
    }
    cores.push({ id, areaKm2: cells * CORE_GRID * CORE_GRID / 1e6, touchesWindowEdge: edge, summits: 0 });
  }
  const summits = [];
  for (let gz = -SPAN / 2 / CELL; gz < SPAN / 2 / CELL; gz += 1) {
    for (let gx = -SPAN / 2 / CELL; gx < SPAN / 2 / CELL; gx += 1) {
      // Mirrors WorldModel.summitTerm's candidate hashes; summitLift and mountainRegion are private.
      const u = (k) => hash2(gx, gz, world.seed + 47 + k);
      if (u(13) >= SUMMIT.odds) continue;
      const lift = world.summitLift(gx, gz, u);
      if (lift === 0) continue;
      const x = (gx + 0.25 + 0.5 * u(0)) * CELL;
      const z = (gz + 0.25 + 0.5 * u(1)) * CELL;
      const top = apex(world, x, z);
      const i = Math.floor((x + SPAN / 2) / CORE_GRID);
      const j = Math.floor((z + SPAN / 2) / CORE_GRID);
      const id = core[j * n + i];
      if (id >= 0) cores[id].summits += 1;
      summits.push({
        cell: [gx, gz], core: id, lift: Math.round(lift),
        x: Math.round(top.x), z: Math.round(top.z), height: Math.round(top.height),
        farLoss: Math.round(top.height - meshHeight(world, top.x, top.z, FAR_STEP)),
      });
      world.trim(20000);
    }
  }
  const heights = summits.map((summit) => summit.height).sort((a, b) => a - b);
  const inner = cores.filter((entry) => !entry.touchesWindowEdge && entry.areaKm2 >= 10);
  return {
    seed,
    summits: summits.length,
    height: { min: heights[0], median: heights[Math.floor(heights.length / 2)], max: heights.at(-1) },
    summitsPerInnerCore: inner.map((entry) => ({ areaKm2: Math.round(entry.areaKm2), summits: entry.summits })),
    list: summits,
  };
}

const report = [57, 42, 80231].map(measure);
for (const entry of report) {
  console.log(`seed ${entry.seed}: ${entry.summits} summits, height ${JSON.stringify(entry.height)}`);
  console.log('  per inner core (km², summits):', entry.summitsPerInnerCore.map((core) => `${core.areaKm2}:${core.summits}`).join(' '));
}
await writeFile(process.argv[3] ?? 'test-results/summits.json', JSON.stringify(report, null, 2));

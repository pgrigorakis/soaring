// Measures the landform: world top, lowland slope, lattice-node slope, and Moor peat pools.
// Repeatable artifact: node scripts/measure-relief.mjs [world-source] [report-path]
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
await build({
  entryPoints: [process.argv[2] ?? 'src/world.ts'],
  outfile: 'test-results/relief-world.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { WorldModel, DRAINAGE_SPACING, gradientNoise, hash2 } = await import('../test-results/relief-world.mjs');

const degree = (rise) => Math.atan(rise) * 180 / Math.PI;
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

function slopeAt(world, x, z, step = 20) {
  const h = world.sample(x, z).height;
  const dx = world.sample(x + step, z).height - world.sample(x - step, z).height;
  const dz = world.sample(x, z + step).height - world.sample(x, z - step).height;
  return { height: h, slope: degree(Math.hypot(dx, dz) / (2 * step)) };
}

function latticeSlopes(world) {
  const atNode = [];
  const halfway = [];
  for (let j = -8; j <= 8; j += 1) {
    for (let i = -8; i <= 8; i += 1) {
      const x = (i + 0.5) * DRAINAGE_SPACING;
      const z = (j + 0.5) * DRAINAGE_SPACING;
      const node = slopeAt(world, x, z);
      const mid = slopeAt(world, x + DRAINAGE_SPACING / 2, z);
      if (!world.sample(x, z).water && world.sample(x, z).biome.highlands < 0.5) atNode.push(node.slope);
      if (!world.sample(x + DRAINAGE_SPACING / 2, z).water && world.sample(x + DRAINAGE_SPACING / 2, z).biome.highlands < 0.5) halfway.push(mid.slope);
    }
  }
  return { node: median(atNode), halfway: median(halfway), nodeCount: atNode.length, halfwayCount: halfway.length };
}

function lowlandStats(world) {
  const slopes = [];
  const bySlope = { hills: [], woodland: [], moor: [] };
  const heights = [];
  const span = 8000;
  const step = 160;
  for (let z = -span; z <= span; z += step) {
    for (let x = -span; x <= span; x += step) {
      const sample = world.sample(x, z);
      if (sample.water || sample.biome.highlands >= 0.5) continue;
      const lowland = sample.biome.hills + sample.biome.woodland + sample.biome.moor + sample.biome.lakeland;
      if (lowland < 0.5) continue;
      const measured = slopeAt(world, x, z);
      slopes.push(measured.slope);
      for (const biome of Object.keys(bySlope)) if (sample.biome[biome] >= 0.9) bySlope[biome].push(measured.slope);
      heights.push({ x, z, height: measured.height });
    }
    world.trim(20000);
  }
  const summits = [];
  for (const point of heights) {
    const neighbors = heights.filter((other) => other !== point && Math.hypot(other.x - point.x, other.z - point.z) <= 480);
    if (neighbors.length < 4 || neighbors.some((other) => other.height >= point.height)) continue;
    const around = [0, 90, 180, 270].map((angle) => {
      const rad = angle * Math.PI / 180;
      return point.height - world.sample(point.x + Math.cos(rad) * 100, point.z + Math.sin(rad) * 100).height;
    });
    summits.push(median(around));
  }
  const under3 = slopes.filter((slope) => slope < 3).length / Math.max(1, slopes.length);
  return {
    samples: slopes.length,
    medianSlope: median(slopes),
    shareUnder3: under3,
    medianSummitDrop: median(summits),
    summits: summits.length,
    biomeMedianSlope: Object.fromEntries(Object.entries(bySlope).map(([biome, values]) => [biome, { samples: values.length, median: median(values) }])),
  };
}

function worldTop(world) {
  const nodes = [];
  for (let j = -48; j <= 48; j += 1) {
    for (let i = -48; i <= 48; i += 1) nodes.push(world.drainageAt(i, j));
  }
  nodes.sort((a, b) => b.elevation - a.elevation);
  let peak = { height: -Infinity, x: 0, z: 0 };
  for (const node of nodes.slice(0, 8)) {
    for (let z = node.z - 600; z <= node.z + 600; z += 60) {
      for (let x = node.x - 600; x <= node.x + 600; x += 60) {
        const sample = world.sample(x, z);
        if (!sample.water && sample.height > peak.height) peak = { x, z, height: sample.height, highland: sample.biome.highlands };
      }
    }
  }
  return { node: { x: nodes[0].x, z: nodes[0].z, elevation: nodes[0].elevation }, peak };
}

/** Peat pools sit on hashed 500 m cell centres, so each candidate centre is sampled once. */
function peatPools(world) {
  const cells = 48;
  let pools = 0;
  let candidates = 0;
  for (let cz = -cells; cz < cells; cz += 1) {
    for (let cx = -cells; cx < cells; cx += 1) {
      if (hash2(cx, cz, world.seed + 193) > 0.22) continue;
      const x = (cx + 0.25 + hash2(cx, cz, world.seed + 194) * 0.5) * 500;
      const z = (cz + 0.25 + hash2(cx, cz, world.seed + 195) * 0.5) * 500;
      const sample = world.sample(x, z);
      if (sample.biome.moor < 0.98) continue;
      candidates += 1;
      if (sample.peat > 0.5) pools += 1;
    }
    world.trim(20000);
  }
  return { pools, moorCandidates: candidates, windowKm: cells };
}

const started = Date.now();
const seeds = [42, 80231, 57];
const report = { seeds: {}, gradientLatticeSlope: null };
const latticeProbe = [];
for (let i = 0; i < 64; i += 1) {
  const x = i;
  const left = gradientNoise(x - 0.02, 0.3, 7);
  const right = gradientNoise(x + 0.02, 0.3, 7);
  latticeProbe.push(Math.abs(right - left) / 0.04);
}
report.gradientLatticeSlope = median(latticeProbe);

for (const seed of seeds) {
  const world = new WorldModel(seed);
  const t0 = Date.now();
  const top = worldTop(world);
  const lattice = latticeSlopes(world);
  const lowland = lowlandStats(world);
  const peat = peatPools(world);
  report.seeds[seed] = { top, lattice, lowland, peat, seconds: (Date.now() - t0) / 1000 };
  console.log(seed, JSON.stringify(report.seeds[seed]));
}
report.seconds = (Date.now() - started) / 1000;
const output = process.argv[3] ?? 'test-results/relief-measures.json';
await writeFile(output, JSON.stringify(report, null, 2));
console.log('wrote', output, report.seconds);

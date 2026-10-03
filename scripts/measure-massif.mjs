// Crest height and far-grid crest loss for the Highlands massif.
// Repeat: node scripts/measure-massif.mjs [world-source] [report-path]
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
await build({
  entryPoints: [process.argv[2] ?? 'src/world.ts'],
  outfile: 'test-results/massif-world.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { WorldModel } = await import('../test-results/massif-world.mjs');

const FAR_STEP = 90;
const NEAR_STEP = 9;

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

function climb(world, x, z, step) {
  let best = { x, z, height: world.sample(x, z).height };
  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false;
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const next = world.sample(best.x + dx, best.z + dz);
      if (!next.water && next.biome.highlands > 0.5 && next.height > best.height + 0.05) {
        best = { x: best.x + dx, z: best.z + dz, height: next.height, highland: next.biome.highlands };
        moved = true;
      }
    }
    if (!moved) break;
  }
  return best;
}

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

function measure(seed) {
  const world = new WorldModel(seed);
  const coarse = [];
  for (let z = -24000; z <= 24000; z += 400) {
    for (let x = -24000; x <= 24000; x += 400) {
      const sample = world.sample(x, z);
      if (!sample.water && sample.biome.highlands > 0.8 && sample.height > 700) coarse.push({ x, z, height: sample.height });
    }
    world.trim(20000);
  }
  coarse.sort((a, b) => b.height - a.height);
  const crests = [];
  for (const start of coarse) {
    if (crests.some((crest) => Math.hypot(crest.x - start.x, crest.z - start.z) < 1600)) continue;
    const crest = climb(world, start.x, start.z, 20);
    const analytic = world.sample(crest.x, crest.z);
    const far = meshHeight(world, crest.x, crest.z, FAR_STEP);
    const near = meshHeight(world, crest.x, crest.z, NEAR_STEP);
    crests.push({
      x: Math.round(crest.x),
      z: Math.round(crest.z),
      height: analytic.height,
      bank: Math.round(analytic.bank),
      farLoss: analytic.height - far,
      nearLoss: analytic.height - near,
    });
    if (crests.length >= 12) break;
  }
  crests.sort((a, b) => b.height - a.height);
  const losses = crests.map((crest) => crest.farLoss);
  return {
    crestCount: crests.length,
    top: crests[0] ?? null,
    medianHeight: median(crests.map((crest) => crest.height)),
    medianFarLoss: median(losses),
    maxFarLoss: losses.length ? Math.max(...losses) : null,
    medianNearLoss: median(crests.map((crest) => crest.nearLoss)),
    crests: crests.slice(0, 8),
  };
}

const started = Date.now();
const report = { seeds: {} };
for (const seed of [57, 42, 80231]) {
  const t0 = Date.now();
  report.seeds[seed] = { ...measure(seed), seconds: (Date.now() - t0) / 1000 };
  console.log(seed, JSON.stringify(report.seeds[seed]));
}
report.seconds = (Date.now() - started) / 1000;
const output = process.argv[3] ?? 'test-results/massif-measures.json';
await writeFile(output, JSON.stringify(report, null, 2));
console.log('wrote', output, report.seconds);

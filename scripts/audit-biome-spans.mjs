// Repeatable integration diagnostic; does not relax the issue's acceptance limits.
// Run: node scripts/audit-biome-spans.mjs [--sweep] [--ref <git-ref>]
// --ref audits the biome selection at another commit, for before-and-after reports.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
const names = ['hills', 'woodland', 'moor', 'highlands', 'lakeland'];
// As in #58, when Lakeland was zero, spans pick the dominant land biome of the landform allocation,
// which reserves no lake territory. Lakeland overlays it and is reported by coverage only.
// The full allocation cannot be used: Lakeland cores zero every land weight, so the tie picks Hills.
const spanNames = names.filter((name) => name !== 'lakeland');
const refIndex = process.argv.indexOf('--ref');
const ref = refIndex > 0 ? process.argv[refIndex + 1] : null;
const scales = process.argv.includes('--sweep') ? (process.env.SCALES ?? "20000,24000,28000,30000").split(",").map(Number) : [null];
const extent = 240000;
const report = { ref: ref ?? 'working tree',
  metric: 'dominant-biome contiguous flight-line chord, excluding boundary-truncated runs',
  spanBiomes: 'hills, woodland, moor, highlands of the landform allocation (Lakeland excluded, as in #58)',
  coverageMetric: 'mean biome weights (not dry-land-only vertex coverage)',
  stepMeters: 100, extentMeters: extent, options: [] };
const source = (path) => ref ? execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' }) : readFile(path, 'utf8');
for (const scale of scales) {
  const outfile = `test-results/biome-world-${ref ?? "tree"}-${scale ?? "default"}-${process.pid}.mjs`.replace(/[^\w./-]/g, '_');
  await build({ entryPoints: ['src/world.ts'], outfile, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'audit-source', setup(builder) {
      builder.onLoad({ filter: /\/src\/\w+\.ts$/ }, async ({ path }) => {
        let contents = await source(path.slice(path.indexOf('src/')));
        // Older revisions computed this allocation but did not return it. Expose it
        // in the bundled diagnostic only, so --ref uses the same metric as today.
        if (ref && path.endsWith('world.ts')) contents = contents.replace(
          /return \{ elevation, mountainRegion, biome(, hills)? \};/,
          (_, hills = '') => `return { elevation, mountainRegion, biome${hills}, landform };`);
        if (path.endsWith('world.ts')) contents += '\nexport { biomeWeights, BIOME_SELECTION, CLIMATE } from "./biome";\n';
        if (scale && path.endsWith('biome.ts')) contents = contents.replace(/scale: \d+/, `scale: ${scale}`);
        for (const [from, to] of (process.env.PATCH ? process.env.PATCH.split("||").map((pair) => pair.split("=>")) : [])) contents = contents.replace(from, to);
        return { contents, loader: 'ts' };
      });
    } }],
  });
  const { WorldModel, biomeWeights, BIOME_SELECTION, CLIMATE, fbm } = await import(`../${outfile}`);
  const fields = (world, x, z) => {
    const relief = world.relief(x, z);
    if (relief.biome) return relief; // Historical drainage generator.
    const climate = world.climate(x, z), mountain = world.mountainRegion(x, z);
    const temperature = climate.seaTemperature - Math.max(0, relief.height) / CLIMATE.lapse;
    const lakeField = Math.max(0, Math.min(1, .5 + fbm(x / BIOME_SELECTION.lakeWavelength,
      z / BIOME_SELECTION.lakeWavelength, world.seed + 131, 4)));
    return { biome: biomeWeights(mountain, temperature, climate.moisture, climate.region, lakeField),
      landform: biomeWeights(mountain, temperature, climate.moisture, climate.region) };
  };
  const option = { climateScaleMeters: scale ?? 'default', seeds: [] };
  report.options.push(option);
  for (const seed of [80231, 42, 123456]) {
    const world = new WorldModel(seed);
    const sums = Object.fromEntries(names.map((name) => [name, 0]));
    const runs = Object.fromEntries(names.map((name) => [name, []]));
    let count = 0;
    // Sample selection fields directly; exclude Lakeland only from chord classification.
    for (let z = -extent / 2; z < extent / 2; z += 500) {
      for (let x = -extent / 2; x < extent / 2; x += 500) {
        const { biome } = fields(world, x, z);
        for (const name of names) sums[name] += biome[name];
        count += 1;
      }
    }
    for (let z = -extent / 2; z < extent / 2; z += 1500) {
      let previous = '';
      let start = -extent / 2;
      for (let x = -extent / 2; x <= extent / 2; x += 100) {
        const { biome, landform } = fields(world, x, z);
        const land = landform ?? biome;
        const name = spanNames.reduce((best, next) => land[next] > land[best] ? next : best);
        if (name === previous) continue;
        if (previous && start > -extent / 2) runs[previous].push(x - start);
        start = x;
        previous = name;
      }
    }
    option.seeds.push({ seed, weights: Object.fromEntries(names.map((name) => [name, sums[name] / count])),
      spans: Object.fromEntries(spanNames.map((name) => {
        const values = runs[name].sort((a, b) => a - b);
        return [name, { runs: values.length, medianMeters: values[Math.floor(values.length / 2)],
          meanMeters: values.reduce((sum, value) => sum + value, 0) / values.length }];
      })) });
  }
  console.log(`Measured ${ref ?? 'working tree'} at climate scale ${scale ?? 'default'}`);
}
const name = ref ? `biome-spans-${ref.replace(/\W/g, '_')}.json` : 'biome-spans.json';
await writeFile(`test-results/${name}`, JSON.stringify(report, null, 2) + '\n');
for (const option of report.options) {
  console.log(`scale ${option.climateScaleMeters}`);
  for (const { seed, weights, spans } of option.seeds) {
    console.log(`  ${seed}: ` + names.map((n) => `${n} ${(weights[n] * 100).toFixed(1)}%` + (spans[n] ? ` / ${(spans[n].medianMeters / 1000).toFixed(1)} km` : '')).join(', '));
  }
}

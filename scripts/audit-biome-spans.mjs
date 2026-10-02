// Repeatable integration diagnostic; does not relax the issue's acceptance limits.
// Run: node scripts/audit-biome-spans.mjs
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
const names = ['hills', 'woodland', 'moor', 'highlands'];
const pairs = process.argv.includes('--sweep')
  ? [[4000, 5400], [8000, 5400], [8000, 9000], [12000, 5400], [12000, 9000],
    [16000, 18000], [24000, 27000], [32000, 36000], [40000, 45000], [48000, 54000],
    [40000, 12000], [48000, 12000], [48000, 15000], [56000, 12000], [56000, 15000], [64000, 15000]]
  : [[4000, 5400]];
const extent = process.argv.includes('--sweep') ? 240000 : 80000;
const report = { metric: 'dominant-biome contiguous flight-line chord, excluding boundary-truncated runs',
  coverageMetric: 'mean pre-drainage biome weights (not dry-land-only vertex coverage)',
  stepMeters: 100, extentMeters: extent, options: [] };
for (const [climateMeters, reliefMeters] of pairs) {
  const outfile = `test-results/biome-world-${climateMeters}-${reliefMeters}.mjs`;
  await build({ entryPoints: ['src/world.ts'], outfile, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'audit-wavelengths', setup(builder) {
      builder.onLoad({ filter: /\/world\.ts$/ }, async ({ path }) => ({
        contents: (await readFile(path, 'utf8'))
          .replaceAll('/ 4000', `/ ${climateMeters}`).replaceAll('/ 5400', `/ ${reliefMeters}`), loader: 'ts',
      }));
    } }],
  });
  const { WorldModel } = await import(`../${outfile}`);
  const option = { climateMeters, reliefMeters, seeds: [] };
  report.options.push(option);
  for (const seed of [80231, 42, 123456]) {
  const world = new WorldModel(seed);
  const sums = Object.fromEntries(names.map((name) => [name, 0]));
  const runs = Object.fromEntries(names.map((name) => [name, []]));
  let count = 0;
  // Pre-drainage field audit avoids river lattice caching affecting measurement.
  for (let z = -extent / 2; z < extent / 2; z += 500) {
    for (let x = -extent / 2; x < extent / 2; x += 500) {
      const { biome } = world.relief(x, z);
      for (const name of names) sums[name] += biome[name];
      count += 1;
    }
  }
  for (let z = -extent / 2; z < extent / 2; z += 1500) {
    let previous = '';
    let start = -extent / 2;
    for (let x = -extent / 2; x <= extent / 2; x += 100) {
      const { biome } = world.relief(x, z);
      const name = names.reduce((best, next) => biome[next] > biome[best] ? next : best);
      if (name === previous) continue;
      if (previous && start > -extent / 2) runs[previous].push(x - start);
      start = x;
      previous = name;
    }
  }
  option.seeds.push({ seed, weights: Object.fromEntries(names.map((name) => [name, sums[name] / count])),
    spans: Object.fromEntries(names.map((name) => {
      const values = runs[name].sort((a, b) => a - b);
      return [name, { runs: values.length, medianMeters: values[Math.floor(values.length / 2)],
        meanMeters: values.reduce((sum, value) => sum + value, 0) / values.length }];
    })) });
  }
  console.log(`Measured climate ${climateMeters} m / relief ${reliefMeters} m`);
}
await writeFile('test-results/biome-spans.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

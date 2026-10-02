// Repeatable integration diagnostic; does not relax the issue's acceptance limits.
// Run: node scripts/audit-biome-spans.mjs
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
await build({ entryPoints: ['src/world.ts'], outfile: 'test-results/biome-world.mjs', bundle: true, platform: 'node', format: 'esm' });
const { WorldModel } = await import('../test-results/biome-world.mjs');
const names = ['hills', 'woodland', 'moor', 'highlands'];
const report = { metric: 'dominant-biome contiguous flight-line chord, excluding boundary-truncated runs', stepMeters: 100, extentMeters: 80000, seeds: [] };
for (const seed of [80231, 42, 123456]) {
  const world = new WorldModel(seed);
  const sums = Object.fromEntries(names.map((name) => [name, 0]));
  const runs = Object.fromEntries(names.map((name) => [name, []]));
  let count = 0;
  // Pre-drainage field audit avoids river lattice caching affecting measurement.
  for (let z = -40000; z < 40000; z += 500) {
    for (let x = -40000; x < 40000; x += 500) {
      const { biome } = world.relief(x, z);
      for (const name of names) sums[name] += biome[name];
      count += 1;
    }
  }
  for (let z = -30000; z < 30000; z += 1500) {
    let previous = '';
    let start = -40000;
    for (let x = -40000; x <= 40000; x += 100) {
      const { biome } = world.relief(x, z);
      const name = names.reduce((best, next) => biome[next] > biome[best] ? next : best);
      if (name === previous) continue;
      if (previous && start > -40000) runs[previous].push(x - start);
      start = x;
      previous = name;
    }
  }
  report.seeds.push({ seed, weights: Object.fromEntries(names.map((name) => [name, sums[name] / count])),
    spans: Object.fromEntries(names.map((name) => {
      const values = runs[name].sort((a, b) => a - b);
      return [name, { runs: values.length, medianMeters: values[Math.floor(values.length / 2)],
        meanMeters: values.reduce((sum, value) => sum + value, 0) / values.length }];
    })) });
}
await writeFile('test-results/biome-spans.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

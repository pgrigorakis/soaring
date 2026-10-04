// Bounded field calibration on a 120 km square, not on a screenshot location.
// node scripts/calibrate-lakeland.mjs -> test-results/lakeland-calibration.json
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
const reports = [];
for (const threshold of [.785, .8, .815]) {
  const outfile = `test-results/lake-threshold-${threshold}.mjs`;
  await build({ entryPoints: ['src/world.ts'], outfile, bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'lake-threshold', setup(builder) {
    builder.onLoad({ filter: /\/biome\.ts$/ }, async ({ path }) => ({ contents: (await readFile(path, 'utf8')).replace(/lakeThreshold: [\d.]+/, `lakeThreshold: ${threshold}`), loader: 'ts' }));
  } }] });
  const { WorldModel } = await import(`../${outfile}`);
  for (const seed of [448122, 80231, 5914]) {
    const world = new WorldModel(seed);
    let land = 0, weight = 0, core = 0;
    for (let z = -60000; z <= 60000; z += 2000) {
      for (let x = -60000; x <= 60000; x += 2000) {
        const s = world.sample(x, z);
        if (!s.water) { land++; weight += s.biome.lakeland; if (s.biome.lakeland > .5) core++; }
      }
      world.trim(20000);
    }
    reports.push({ threshold, seed, samples: 3721, land, weightedCoverage: weight / land, dominantCoverage: core / land });
  }
}
await writeFile('test-results/lakeland-calibration.json', JSON.stringify(reports, null, 2) + '\n');
console.log(JSON.stringify(reports, null, 2));

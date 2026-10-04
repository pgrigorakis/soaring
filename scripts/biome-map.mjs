// Top-down biome map for review: dominant-weighted colour blend from WorldModel.relief().
// Run: node scripts/biome-map.mjs <seed> [--ref <git-ref>] [--tag <name>] [--size 120000] [--pixel 200] [--out <dir>]
// Writes <dir>/biome-map-<tag>-<seed>.png (default dir test-results) through a BMP and macOS sips.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : fallback; };
const seed = Number(process.argv[2] ?? 80231);
const ref = arg('--ref', null);
const size = Number(arg('--size', 120000));
const pixel = Number(arg('--pixel', 200));
const tag = (arg('--tag', null) ?? ref ?? 'tree').replace(/\W/g, '_');
await mkdir('test-results', { recursive: true });
const outfile = `test-results/biome-map-world-${tag}-${process.pid}.mjs`;
await mkdir(arg('--out', 'test-results'), { recursive: true });
const source = (path) => ref ? execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' }) : readFile(path, 'utf8');
await build({ entryPoints: ['src/world.ts'], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
  plugins: [{ name: 'map-source', setup(builder) {
    builder.onLoad({ filter: /\/src\/\w+\.ts$/ }, async ({ path }) => {
      let contents = await source(path.slice(path.indexOf('src/')));
      // PATCH="from=>to||from=>to" previews a candidate without editing runtime source.
      for (const [from, to] of (process.env.PATCH ? process.env.PATCH.split('||').map((pair) => pair.split('=>')) : [])) contents = contents.replace(from, to);
      return { contents, loader: 'ts' };
    });
  } }] });
const { WorldModel } = await import(`../${outfile}`);
const colours = { hills: [140, 199, 74], woodland: [87, 155, 59], moor: [147, 167, 108], highlands: [158, 165, 154], lakeland: [60, 140, 190] };
const world = new WorldModel(seed);
const width = Math.round(size / pixel);
const row = Math.ceil(width * 3 / 4) * 4;
const data = Buffer.alloc(54 + row * width);
data.write('BM', 0); data.writeUInt32LE(data.length, 2); data.writeUInt32LE(54, 10); data.writeUInt32LE(40, 14);
data.writeInt32LE(width, 18); data.writeInt32LE(width, 22); data.writeUInt16LE(1, 26); data.writeUInt16LE(24, 28);
for (let j = 0; j < width; j += 1) {
  for (let i = 0; i < width; i += 1) {
    const x = -size / 2 + (i + 0.5) * pixel;
    const z = -size / 2 + (j + 0.5) * pixel;
    const { biome } = world.relief(x, z);
    const rgb = [0, 0, 0];
    for (const [name, colour] of Object.entries(colours)) for (let c = 0; c < 3; c += 1) rgb[c] += colour[c] * biome[name];
    // BMP rows run bottom-up; +z is drawn downward, matching a north-up map with -z at the top.
    const offset = 54 + (width - 1 - j) * row + i * 3;
    data[offset] = rgb[2]; data[offset + 1] = rgb[1]; data[offset + 2] = rgb[0];
  }
}
const bmp = `${arg('--out', 'test-results')}/biome-map-${tag}-${seed}.bmp`;
await writeFile(bmp, data);
execFileSync('sips', ['-s', 'format', 'png', bmp, '--out', bmp.replace(/\.bmp$/, '.png')], { stdio: 'ignore' });
await rm(bmp);
console.log(bmp.replace(/\.bmp$/, '.png'));

// Repeatable source-sampled map, not a product screenshot. Run before and after
// with seed 42 and identical bounds. Guard negative coordinates and water masks.
import { build } from 'esbuild';
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const label = process.argv[2] ?? 'after';
const out = 'test-results/terrain-map';
await mkdir('.scratch', { recursive: true });
await mkdir(out, { recursive: true });
await build({
  entryPoints: ['src/world.ts'],
  outfile: '.scratch/map-world.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { WorldModel } = await import('../.scratch/map-world.mjs');
const world = new WorldModel(42);
const n = 320,
  step = 75,
  min = -12000;
const samples = [];
let wet = 0,
  low = Infinity,
  high = -Infinity;
for (let j = 0; j < n; j++)
  for (let i = 0; i < n; i++) {
    const s = world.sample(min + (i + 0.5) * step, min + (j + 0.5) * step);
    samples.push(s);
    wet += Number(s.water);
    low = Math.min(low, s.height);
    high = Math.max(high, s.height);
    if (i === 0) world.trim(20000);
  }
const stops = [
  [-60, [37, 56, 61]],
  [0, [77, 96, 66]],
  [100, [139, 157, 102]],
  [250, [179, 181, 128]],
  [600, [173, 155, 128]],
  [1100, [241, 236, 214]],
  [1300, [255, 255, 250]],
];
function ramp(h) {
  for (let k = 1; k < stops.length; k++)
    if (h <= stops[k][0]) {
      const [a, ca] = stops[k - 1],
        [b, cb] = stops[k],
        t = Math.max(0, Math.min(1, (h - a) / (b - a)));
      return ca.map((c, i) => c + (cb[i] - c) * t);
    }
  return stops.at(-1)[1];
}
const pixels = Buffer.alloc(n * (n * 3 + 1));
for (let j = 0; j < n; j++)
  for (let i = 0; i < n; i++) {
    const s = samples[j * n + i];
    const dx =
      (samples[j * n + Math.min(n - 1, i + 1)].height - samples[j * n + Math.max(0, i - 1)].height) / (2 * step);
    const dz =
      (samples[Math.min(n - 1, j + 1) * n + i].height - samples[Math.max(0, j - 1) * n + i].height) / (2 * step);
    const shade =
      0.65 + 0.45 * Math.max(0, (1 - dx * 0.6 - dz * 0.6) / Math.sqrt(1 + dx * dx + dz * dz) / Math.sqrt(1.72));
    const rgb = s.water ? [55, 154, 176] : ramp(s.height).map((c) => Math.max(0, Math.min(255, Math.round(c * shade))));
    rgb.forEach((c, k) => (pixels[j * (n * 3 + 1) + 1 + i * 3 + k] = c));
  }
function crc(buf) {
  let c = -1;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    sum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, sum]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(n);
ihdr.writeUInt32BE(n, 4);
ihdr[8] = 8;
ihdr[9] = 2;
await writeFile(
  `${out}/map-${label}.png`,
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
await writeFile(
  `${out}/map-${label}.json`,
  JSON.stringify(
    { seed: 42, n, step, min, max: min + n * step, waterFraction: wet / (n * n), minHeight: low, maxHeight: high },
    null,
    2,
  ),
);
console.log({ label, wet, low, high });

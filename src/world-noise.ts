// Soaring's deterministic noise. Landforms use gradient noise; appearance uses value noise.
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
export function smootherstep(a: number, b: number, value: number): number {
  const t = clamp01((value - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
export function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ Math.imul(seed | 0, 0x6c8e9cf5);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = smooth(x - ix),
    fz = smooth(z - iz);
  return (
    mix(
      mix(hash2(ix, iz, seed), hash2(ix + 1, iz, seed), fx),
      mix(hash2(ix, iz + 1, seed), hash2(ix + 1, iz + 1, seed), fx),
      fz,
    ) *
      2 -
    1
  );
}
export function fbm(x: number, z: number, seed: number, octaves = 5): number {
  let value = 0,
    amplitude = 0.53,
    frequency = 1,
    total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise(x * frequency, z * frequency, seed + octave * 1013) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / total;
}
const gradients = new Float32Array(128);
for (let i = 0; i < 64; i++) {
  gradients[i * 2] = Math.cos((i / 64) * Math.PI * 2);
  gradients[i * 2 + 1] = Math.sin((i / 64) * Math.PI * 2);
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export function gradientNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz;
  const dot = (gx: number, gz: number, dx: number, dz: number) => {
    const i = Math.floor(hash2(gx, gz, seed) * 64);
    return gradients[i * 2]! * dx + gradients[i * 2 + 1]! * dz;
  };
  return (
    mix(
      mix(dot(ix, iz, fx, fz), dot(ix + 1, iz, fx - 1, fz), fade(fx)),
      mix(dot(ix, iz + 1, fx, fz - 1), dot(ix + 1, iz + 1, fx - 1, fz - 1), fade(fx)),
      fade(fz),
    ) * 1.6
  );
}
export function gradientFbm(x: number, z: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let value = 0,
    amplitude = 1,
    frequency = 1,
    total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value += gradientNoise(x * frequency, z * frequency, seed + octave * 131) * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / total;
}
export function ridgedMulti(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0,
    amplitude = 1,
    frequency = 1,
    norm = 0,
    weight = 1;
  for (let octave = 0; octave < octaves; octave++) {
    const noise = gradientNoise(x * frequency, z * frequency, seed + octave * 977);
    let n = 1 - Math.sqrt(noise * noise + 0.012 + 0.03 * octave);
    n = n * n * weight;
    weight = clamp01(n * 1.7);
    sum += n * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.05;
  }
  return sum / norm;
}
export function farmland(x: number, z: number, seed: number) {
  const size = 300,
    cx = Math.floor(x / size),
    cz = Math.floor(z / size);
  let first = { x: 0, z: 0, distance: Infinity, field: 0 },
    second = first;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const i = cx + dx,
        j = cz + dz;
      const sx = (i + 0.2 + hash2(i, j, seed + 153) * 0.6) * size;
      const sz = (j + 0.2 + hash2(i, j, seed + 154) * 0.6) * size;
      const site = { x: sx, z: sz, distance: (x - sx) ** 2 + (z - sz) ** 2, field: hash2(i, j, seed + 156) };
      if (site.distance < first.distance) {
        second = first;
        first = site;
      } else if (site.distance < second.distance) second = site;
    }
  const dx = second.x - first.x,
    dz = second.z - first.z,
    separation = Math.hypot(dx, dz);
  const distance = (second.distance - first.distance) / (2 * separation);
  return {
    field: first.field,
    hedge: 1 - smootherstep(1, 3, distance),
    fieldEdge:
      distance < 6
        ? { x: x + (dx / separation) * distance, z: z + (dz / separation) * distance, turn: Math.atan2(-dz, dx) }
        : null,
  };
}

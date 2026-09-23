export type LandscapeSample = {
  height: number;
  moisture: number;
  forest: number;
  rock: number;
  water: boolean;
  river: boolean;
};

export type Thermal = { x: number; z: number; strength: number };

const fract = (value: number) => value - Math.floor(value);
const smooth = (value: number) => value * value * (3 - 2 * value);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ Math.imul(seed | 0, 0x6c8e9cf5);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(fract(x));
  const fz = smooth(fract(z));
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return mix(mix(a, b, fx), mix(c, d, fx), fz) * 2 - 1;
}

export function fbm(x: number, z: number, seed: number, octaves = 5): number {
  let value = 0;
  let amplitude = 0.53;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise(x * frequency, z * frequency, seed + octave * 1013) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / total;
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class WorldModel {
  readonly seed: number;
  readonly waterLevel = 2;

  constructor(seed: number) {
    this.seed = seed | 0;
  }

  sample(x: number, z: number): LandscapeSample {
    const broad = fbm(x / 2200, z / 2200, this.seed + 7, 4);
    const rolling = fbm(x / 430, z / 430, this.seed + 19, 5);
    const detail = fbm(x / 115, z / 115, this.seed + 31, 3);
    const ridges = 1 - Math.abs(fbm(x / 1050, z / 1050, this.seed + 47, 5));
    const mountainRegion = smootherstep(0.08, 0.52, broad + fbm(x / 4300, z / 4300, this.seed + 59, 3) * 0.42);
    const mountains = mountainRegion * Math.pow(clamp01((ridges - 0.42) / 0.58), 2) * 185;

    const verticalBand = Math.round(x / 3100);
    const verticalPhase = hash2(verticalBand, 0, this.seed + 67) * Math.PI * 2;
    const verticalCenter = verticalBand * 3100
      + (hash2(verticalBand, 1, this.seed + 71) - 0.5) * 460
      + Math.sin(z / (620 + hash2(verticalBand, 2, this.seed + 73) * 330) + verticalPhase) * 190
      + Math.sin(z / 241 + verticalPhase * 0.4) * 38;
    const horizontalBand = Math.round(z / 4700);
    const horizontalPhase = hash2(0, horizontalBand, this.seed + 75) * Math.PI * 2;
    const horizontalCenter = horizontalBand * 4700
      + (hash2(1, horizontalBand, this.seed + 77) - 0.5) * 520
      + Math.sin(x / (790 + hash2(2, horizontalBand, this.seed + 79) * 280) + horizontalPhase) * 155;
    const verticalDistance = Math.abs(x - verticalCenter);
    const horizontalDistance = Math.abs(z - horizontalCenter);
    const riverDistance = Math.min(verticalDistance, horizontalDistance * 1.12);
    const river = riverDistance < 14;

    const lakeNoise = fbm(x / 540, z / 540, this.seed + 83, 4);
    const lakeGate = fbm(x / 1700, z / 1700, this.seed + 97, 3);
    const lakeShape = smootherstep(0.57, 0.72, lakeNoise) * smootherstep(-0.15, 0.25, lakeGate);
    const lake = lakeShape > 0.58;

    const land = 18 + broad * 35 + rolling * 22 + detail * 4 + mountains - lakeShape * 48;
    const riverBed = this.waterLevel - 2.7 + riverDistance * 0.06;
    const valleyDepth = Math.max(0, land - riverBed);
    let height = land - valleyDepth * (1 - smootherstep(14, 60 + valleyDepth * 2.4, riverDistance));
    if (lake) height = Math.min(height, this.waterLevel - 3.5 - lakeShape * 3);

    const moisture = clamp01(0.58 + fbm(x / 650, z / 650, this.seed + 121, 4) * 0.42 + (lake || river ? 0.3 : 0));
    const forest = clamp01((moisture - 0.33) * 1.65 - mountainRegion * 0.45 + fbm(x / 260, z / 260, this.seed + 139, 3) * 0.28);
    const rock = clamp01(mountainRegion * 0.75 + smootherstep(74, 148, height) + Math.abs(detail) * 0.2);

    return { height, moisture, forest, rock, water: lake || river || height < this.waterLevel, river };
  }

  thermalAtCell(cellX: number, cellZ: number): Thermal {
    const size = 1100;
    const x = (cellX + 0.16 + hash2(cellX, cellZ, this.seed + 211) * 0.68) * size;
    const z = (cellZ + 0.16 + hash2(cellX, cellZ, this.seed + 223) * 0.68) * size;
    return { x, z, strength: 0.72 + hash2(cellX, cellZ, this.seed + 227) * 0.72 };
  }

  nearbyThermals(x: number, z: number, radiusCells = 2): Thermal[] {
    const cellSize = 1100;
    const centerX = Math.floor(x / cellSize);
    const centerZ = Math.floor(z / cellSize);
    const thermals: Thermal[] = [];
    for (let dz = -radiusCells; dz <= radiusCells; dz += 1) {
      for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
        thermals.push(this.thermalAtCell(centerX + dx, centerZ + dz));
      }
    }
    return thermals;
  }

  interest(x: number, z: number): number {
    const center = this.sample(x, z);
    let low = center.height;
    let high = center.height;
    let water = center.water;
    for (const [dx, dz] of [[170, 0], [-170, 0], [0, 170], [0, -170]] as const) {
      const around = this.sample(x + dx, z + dz);
      low = Math.min(low, around.height);
      high = Math.max(high, around.height);
      water ||= around.water;
    }
    return Math.min(1, (high - low) / 120) + (water ? 0.8 : 0) + center.rock * 0.35 + Math.min(center.forest, 1 - center.forest) * 0.5;
  }

  scenicStart(visit: number): { x: number; z: number; heading: number } {
    const ring = 3 + (visit % 9);
    let best = { x: 0, z: 0, heading: 0 };
    let bestScore = -Infinity;
    for (let candidate = 0; candidate < 8; candidate += 1) {
      const angle = hash2(visit * 8 + candidate, ring, this.seed + 251) * Math.PI * 2;
      const radius = ring * 920 + hash2(ring, visit * 8 + candidate, this.seed + 257) * 700;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const score = this.interest(x, z);
      if (score <= bestScore) continue;
      bestScore = score;
      best = { x, z, heading: angle + Math.PI * (0.72 + hash2(visit, candidate, this.seed + 263) * 0.56) };
    }
    return best;
  }
}

export function seedFromText(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }
  return value | 0;
}

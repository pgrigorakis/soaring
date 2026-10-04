import {
  BIOME_PROFILES,
  BIOME_SELECTION,
  CLIMATE,
  CLIMATE_LINES,
  WOODLAND_GLADES,
  biomeWeights,
  blendParameter,
  transition,
  type BiomeWeights,
} from './biome';
import { clamp01, smootherstep, hash2, fbm, gradientFbm, ridgedMulti, farmland } from './world-noise';
export { hash2, fbm, gradientNoise, gradientFbm, ridgedMulti, farmland } from './world-noise';

export type LandscapeSample = {
  biome: BiomeWeights;
  glade: number;
  field: number;
  hedge: number;
  fieldEdge?: { x: number; z: number; turn: number } | null;
  moorPatch: number;
  peat: number;
  height: number;
  mountainRegion: number;
  /** All water shares sea level, including inland basins. */
  surface: number;
  /** Signed local shore-distance estimate in metres; negative underwater. */
  bank: number;
  moisture: number;
  temperature: number;
  forest: number;
  rock: number;
  water: boolean;
  /** Compatibility fields. No rivers, elevated peat pools or explicit lake islands exist. */
  river: false;
  island?: boolean;
};
export type Thermal = { x: number; z: number; strength: number };
export type Tree = {
  x: number;
  y: number;
  z: number;
  kind: number;
  scale: number;
  turn: number;
  tint: number;
  biome: BiomeWeights;
};
export type Shore = { x: number; z: number; normalX: number; normalZ: number; distance: number };
export type WorldCacheSizes = { thermals: number };
export const SEA_LEVEL = 0;
export const WORLD_CACHE_LIMIT = 20_000;
export const SUN_OFFSET = { x: -420, y: 190, z: -300 } as const;
const SUN_LENGTH = Math.hypot(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
const THERMAL_CELL = 1800;
const THERMAL_CANDIDATES = 5;
/** FWM's geometry and lift. Soaring retains its smooth summit-foot cutoff. */
export const SUMMIT = {
  cell: 2400,
  radius: 850,
  power: 1.7,
  lift: 900,
  massif: 640,
  warp: 90,
  warpWavelength: 700,
} as const;
export const highlandWeight = (region: number): number => transition(0.55, region);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export class WorldModel {
  readonly seed: number;
  private readonly thermals = new Map<string, Thermal | null>();
  private readonly landSeed: number;
  private readonly temperatureSeed: number;
  private readonly regionSeed: number;
  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.landSeed = Math.floor(hash2(this.seed, 1, 0x1a2b) * 0x10000);
    this.temperatureSeed = Math.floor(hash2(this.seed, 2, 0x3c4d) * 0x10000);
    this.regionSeed = Math.floor(hash2(this.seed, 3, 0x5e6f) * 0x10000);
  }
  trim(maxEntries: number): WorldCacheSizes {
    if (!Number.isInteger(maxEntries) || maxEntries < 0)
      throw new RangeError('maxEntries must be a non-negative integer');
    while (this.thermals.size > maxEntries) this.thermals.delete(this.thermals.keys().next().value!);
    return { thermals: this.thermals.size };
  }

  /** FWM continental land, hill amplitude, mountain mask and global sea shelf.
   * Climate and biome profiles do not own any height term. */
  private relief(x: number, z: number) {
    const s = this.landSeed,
      w = this.regionSeed;
    const wx = x + 700 * gradientFbm(x / 2200 + 31.7, z / 2200 - 12.3, w, 3);
    const wz = z + 700 * gradientFbm(x / 2200 - 54.1, z / 2200 + 77.9, w + 7, 3);
    const continentalness = gradientFbm(wx / 3400, wz / 3400, s, 4) * 0.5 + 0.5;
    const land = sstep(0.4, 0.6, continentalness);
    const hills = gradientFbm(wx / 520, wz / 520, s + 11, 4) * (10 + 38 * land);
    const mountainMask = sstep(0.56, 0.82, continentalness);
    const rx = wx + 260 * gradientFbm(wx / 900 + 3.3, wz / 900 - 1.1, s + 29, 2);
    const rz = wz + 260 * gradientFbm(wx / 900 - 2.2, wz / 900 + 4.4, s + 31, 2);
    const ridge = mountainMask > 0 ? ridgedMulti(rx / 1600, rz / 1600, s + 23, 4) : 0;
    const peak = mountainMask > 0 ? this.summitTerm(x, z) : 0;
    const lift = (ridge * SUMMIT.massif * (1 - 0.45 * sstep(0.05, 0.5, peak)) + peak * SUMMIT.lift) * mountainMask;
    const elevation = -70 + 150 * land + hills + lift;
    const shelf = sstep(-30, 30, elevation);
    const height = elevation * (0.55 + 0.45 * shelf) + (1 - shelf) * -6;
    return { height, elevation, hills, continentalness, mountainMask };
  }
  private summitTerm(x: number, z: number): number {
    const s = this.landSeed;
    const px = x + 90 * gradientFbm(x / 700 + 1.3, z / 700 + 2.1, s + 61, 2);
    const pz = z + 90 * gradientFbm(x / 700 - 3.7, z / 700 + 0.4, s + 63, 2);
    const cx = Math.floor(px / SUMMIT.cell),
      cz = Math.floor(pz / SUMMIT.cell);
    let acc = 0;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const gx = cx + i,
          gz = cz + j,
          u = (k: number) => hash2(gx, gz, s + 47 + k);
        const dx = px - (gx + 0.25 + 0.5 * u(0)) * SUMMIT.cell;
        const dz = pz - (gz + 0.25 + 0.5 * u(1)) * SUMMIT.cell;
        const distance = Math.hypot(dx, dz);
        if (distance >= SUMMIT.radius * 1.5) continue;
        const faces = u(2) < 0.45 ? 3 : 4,
          spin = u(3) * Math.PI * 2,
          amp = 0.55 + 0.45 * u(4);
        let de = 0;
        for (let face = 0; face < faces; face++) {
          const angle = spin + ((face + 0.3 * (u(5 + face) - 0.5)) * Math.PI * 2) / faces;
          const reach = SUMMIT.radius * (0.7 + 0.6 * u(9 + face)) * (0.6 + 0.4 * amp);
          de = Math.max(de, (dx * Math.cos(angle) + dz * Math.sin(angle)) / reach);
        }
        // Keep Soaring's continuous cutoff and zero-preserving soft maximum.
        const f =
          Math.max(0, 1 - de) ** SUMMIT.power * amp * (1 - smootherstep(SUMMIT.radius, SUMMIT.radius * 1.5, distance));
        const k = 0.06,
          h = Math.max(k - Math.abs(acc - f), 0) / k;
        acc = Math.max(acc, f) + h * h * k * 0.25 * clamp01(Math.min(acc, f) / k);
      }
    return acc;
  }
  private climate(x: number, z: number) {
    const wavelength = CLIMATE.scale;
    const kx = x + CLIMATE.warp * gradientFbm(x / 3000 + 4.1, z / 3000 - 2.2, this.regionSeed + 41, 2);
    const kz = z + CLIMATE.warp * gradientFbm(x / 3000 - 7.7, z / 3000 + 5.5, this.regionSeed + 43, 2);
    return {
      seaTemperature: gradientFbm(kx / wavelength + 9.1, kz / wavelength + 3.3, this.temperatureSeed, 2) * 0.5 + 0.5,
      moisture:
        gradientFbm(kx / (wavelength * 0.8) - 8.4, kz / (wavelength * 0.8) + 15.2, this.temperatureSeed + 3, 2) * 0.5 +
        0.5,
      region:
        gradientFbm(kx / (wavelength * 0.9) + 21.3, kz / (wavelength * 0.9) - 8.8, this.regionSeed + 19, 2) * 0.5 + 0.5,
    };
  }
  private mountainRegion(x: number, z: number): number {
    return smootherstep(
      0.04,
      0.48,
      fbm(x / BIOME_SELECTION.reliefWavelength, z / BIOME_SELECTION.reliefWavelength, this.seed + 61, 3),
    );
  }
  sample(x: number, z: number): LandscapeSample {
    const { height } = this.relief(x, z);
    const mountainRegion = this.mountainRegion(x, z);
    const climate = this.climate(x, z);
    const temperature = climate.seaTemperature - Math.max(0, height) / CLIMATE.lapse;
    const lakeField = clamp01(
      0.5 + fbm(x / BIOME_SELECTION.lakeWavelength, z / BIOME_SELECTION.lakeWavelength, this.seed + 131, 4),
    );
    const biome = biomeWeights(mountainRegion, temperature, climate.moisture, climate.region, lakeField);
    const water = height < SEA_LEVEL;
    // A tangent-plane distance estimate is continuous and cheap. Navigation uses
    // actual zero crossings instead, so this estimate cannot invent a lake disc.
    const slope = Math.hypot(this.relief(x + 8, z).height - height, this.relief(x, z + 8).height - height) / 8;
    const bank = (height - SEA_LEVEL) / Math.max(0.025, slope);
    const shoreside = 1 - smootherstep(6, 80, bank);
    const moisture = clamp01(0.5 + fbm(x / 650, z / 650, this.seed + 121, 4) * 0.42 + (water ? 0.3 : shoreside * 0.22));
    const woodland =
      biome.highlands > 0
        ? fbm(x / 1450, z / 1450, this.seed + 139, 4) * 0.86 +
          fbm(x / 290, z / 290, this.seed + 149, 3) * 0.25 +
          (moisture - 0.5) * 0.18
        : 0;
    const glade =
      biome.woodland > 0
        ? smootherstep(
            WOODLAND_GLADES.start,
            WOODLAND_GLADES.end,
            fbm(x / WOODLAND_GLADES.wavelength, z / WOODLAND_GLADES.wavelength, this.seed + 151, 2),
          )
        : 0;
    const { field, hedge, fieldEdge } =
      biome.hills > 0 ? farmland(x, z, this.seed) : { field: 0, hedge: 0, fieldEdge: null };
    const legacyForest = Math.max(smootherstep(-0.04, 0.05, woodland), shoreside * 0.62) * (1 - mountainRegion * 0.5);
    const forest = water
      ? 0
      : biome.hills * (BIOME_PROFILES.hills.forestDensity + hedge * 0.55) +
        biome.woodland * BIOME_PROFILES.woodland.forestDensity * (1 - glade) +
        biome.moor * BIOME_PROFILES.moor.forestDensity +
        biome.highlands * legacyForest +
        biome.lakeland * BIOME_PROFILES.lakeland.forestDensity;
    const moorPatch = biome.moor > 0 ? clamp01(0.5 + fbm(x / 250, z / 250, this.seed + 155, 2)) : 0;
    const detail = fbm(x / 125, z / 125, this.seed + 31, 3) * 4.2 + fbm(x / 46, z / 46, this.seed + 37, 2) * 1.05;
    const rock = clamp01(
      biome.highlands * (mountainRegion * 0.74 + smootherstep(96, 170, height)) +
        blendParameter(biome, 'rockBias', 0) +
        biome.moor * smootherstep(0.6, 2.8, detail) * 0.7,
    );
    return {
      height,
      mountainRegion,
      surface: SEA_LEVEL,
      bank,
      moisture,
      temperature,
      forest,
      rock,
      water,
      river: false,
      biome,
      glade,
      field,
      hedge,
      fieldEdge,
      moorPatch,
      peat: 0,
      island: false,
    };
  }

  /** Find an actual coast/basin shoreline by bounded rays and binary zero crossings.
   * There are no explicit lakes. Returns an outward (dry-side) unit normal. */
  nearestShore(x: number, z: number, range = 2200): Shore | null {
    const wet = this.relief(x, z).height < 0;
    let best: Shore | null = null;
    for (let direction = 0; direction < 16; direction++) {
      const angle = (direction * Math.PI) / 8,
        dx = Math.cos(angle),
        dz = Math.sin(angle);
      let previous = 0;
      for (let distance = 80; distance <= range; distance += 80) {
        if (best && distance - 80 > best.distance) break;
        if (this.relief(x + dx * distance, z + dz * distance).height < 0 === wet) {
          previous = distance;
          continue;
        }
        let low = previous,
          high = distance;
        for (let step = 0; step < 14; step++) {
          const mid = (low + high) / 2;
          if (this.relief(x + dx * mid, z + dz * mid).height < 0 === wet) low = mid;
          else high = mid;
        }
        const d = (low + high) / 2,
          sx = x + dx * d,
          sz = z + dz * d;
        if (!best || d < best.distance) {
          const nx = this.relief(sx + 4, sz).height - this.relief(sx - 4, sz).height;
          const nz = this.relief(sx, sz + 4).height - this.relief(sx, sz - 4).height;
          const length = Math.hypot(nx, nz);
          best = {
            x: sx,
            z: sz,
            normalX: length > 0 ? nx / length : wet ? dx : -dx,
            normalZ: length > 0 ? nz / length : wet ? dz : -dz,
            distance: d,
          };
        }
        break;
      }
    }
    return best;
  }
  landmarkNear(x: number, z: number, radius = 10): { x: number; z: number; surface: number; lake: boolean } | null {
    if (this.sample(x, z).water) return { x, z, surface: SEA_LEVEL, lake: true };
    for (let ring = 1; ring <= radius; ring++)
      for (let direction = 0; direction < 16; direction++) {
        const angle = (direction * Math.PI) / 8,
          px = x + Math.cos(angle) * ring * 500,
          pz = z + Math.sin(angle) * ring * 500;
        if (this.sample(px, pz).water) return { x: px, z: pz, surface: SEA_LEVEL, lake: true };
      }
    return null;
  }
  reviewSpots() {
    const lake = this.landmarkNear(0, 0) ?? { x: 0, z: 0, surface: 0 };
    const coast = this.nearestShore(lake.x, lake.z, 5000) ?? lake;
    const basin = this.landmarkNear(6000, 6000) ?? lake;
    return { coast: { ...coast, surface: 0 }, lake, basin: { ...basin, heading: 0 }, islands: { ...lake, surface: 0 } };
  }

  treesInArea(minX: number, minZ: number, size: number, spacing: number): Tree[] {
    const build = this.buildTreesInArea(minX, minZ, size, spacing);
    let result = build.next();
    while (!result.done) result = build.next();
    return result.value;
  }
  *buildTreesInArea(minX: number, minZ: number, size: number, spacing: number): Generator<void, Tree[]> {
    const trees: Tree[] = [];
    for (let cz = Math.floor(minZ / spacing); cz <= Math.floor((minZ + size) / spacing); cz++) {
      for (let cx = Math.floor(minX / spacing); cx <= Math.floor((minX + size) / spacing); cx++) {
        const x = (cx + 0.15 + hash2(cx, cz, this.seed + 337) * 0.7) * spacing,
          z = (cz + 0.15 + hash2(cx, cz, this.seed + 347) * 0.7) * spacing;
        if (x < minX || x >= minX + size || z < minZ || z >= minZ + size) continue;
        const sample = this.sample(x, z);
        const clumping = sample.biome.highlands > 0 ? 0.5 + fbm(x / 120, z / 120, this.seed + 157, 2) * 1.2 : 0;
        const density = blendParameter(sample.biome, 'treeDensity', 1),
          gx = Math.floor(x / 1000),
          gz = Math.floor(z / 1000);
        const groveX = (gx + 0.3 + hash2(gx, gz, this.seed + 158) * 0.4) * 1000,
          groveZ = (gz + 0.3 + hash2(gx, gz, this.seed + 159) * 0.4) * 1000;
        const moorGrove =
          hash2(gx, gz, this.seed + 160) < 0.25 ? 1 - smootherstep(100, 150, Math.hypot(x - groveX, z - groveZ)) : 0;
        const chance =
          sample.biome.hills * (0.018 + sample.hedge * 0.45) +
          sample.biome.woodland * (1 - sample.glade) * 0.35 * density +
          sample.biome.moor * (0.004 + moorGrove * 0.3) +
          sample.biome.highlands * (0.018 + sample.forest * clumping) +
          sample.biome.lakeland * 0.2;
        const [treeStart, treeEnd] = CLIMATE_LINES.treeLine;
        if (
          sample.water ||
          (sample.temperature <= treeEnd && sample.biome.highlands > 0.5) ||
          sample.rock > mix(0.72, 1, sample.biome.highlands) ||
          hash2(cx, cz, this.seed + 349) >
            chance * (1 - sample.biome.highlands * smootherstep(treeStart, treeEnd, sample.temperature)) ||
          sample.bank < 18
        )
          continue;
        const slope =
          Math.hypot(this.sample(x + 3, z).height - sample.height, this.sample(x, z + 3).height - sample.height) / 3;
        if (slope > 0.6) continue;
        const b = sample.biome;
        const conifer =
          b.hills * BIOME_PROFILES.hills.species[0] +
          b.woodland * BIOME_PROFILES.woodland.species[0] +
          b.moor * BIOME_PROFILES.moor.species[0] +
          b.highlands +
          b.lakeland * BIOME_PROFILES.lakeland.species[0];
        const birch =
          b.hills * BIOME_PROFILES.hills.species[2] +
          b.woodland * BIOME_PROFILES.woodland.species[2] +
          b.moor * BIOME_PROFILES.moor.species[2] +
          b.lakeland * BIOME_PROFILES.lakeland.species[2];
        const species = hash2(cx, cz, this.seed + 353),
          kind = species < conifer ? 0 : species > 1 - birch ? 2 : 1;
        const autumn = hash2(cx, cz, this.seed + 355) < b.woodland * 0.04;
        const tint = autumn
          ? hash2(cx, cz, this.seed + 356) < 0.25
            ? 0xd9a441
            : 0xc9772e
          : kind === 2
            ? 0x9dbf4e
            : kind === 0
              ? 0x1f5a34
              : b.woodland > hash2(cx, cz, this.seed + 358)
                ? BIOME_PROFILES.woodland.palette[Math.floor(hash2(cx, cz, this.seed + 357) * 3)]!
                : 0x2e7a3e;
        trees.push({
          x,
          y: sample.height,
          z,
          kind,
          tint,
          biome: b,
          scale: (0.8 + hash2(cx, cz, this.seed + 359) * 0.4) * blendParameter(b, 'crownScale', 1),
          turn: hash2(cx, cz, this.seed + 361) * Math.PI * 2,
        });
      }
      yield;
    }
    return trees;
  }
  thermalAtCell(cellX: number, cellZ: number): Thermal | null {
    const key = `${cellX},${cellZ}`,
      cached = this.thermals.get(key);
    if (cached !== undefined) {
      this.thermals.delete(key);
      this.thermals.set(key, cached);
      return cached;
    }
    let best: Thermal | null = null,
      bestScore = 0;
    const strength = 0.72 + hash2(cellX, cellZ, this.seed + 227) * 0.72;
    for (let iz = 0; iz < THERMAL_CANDIDATES; iz++)
      for (let ix = 0; ix < THERMAL_CANDIDATES; ix++) {
        const gx = cellX * THERMAL_CANDIDATES + ix,
          gz = cellZ * THERMAL_CANDIDATES + iz;
        const x = (cellX + (ix + 0.18 + hash2(gx, gz, this.seed + 211) * 0.64) / THERMAL_CANDIDATES) * THERMAL_CELL;
        const z = (cellZ + (iz + 0.18 + hash2(gx, gz, this.seed + 223) * 0.64) / THERMAL_CANDIDATES) * THERMAL_CELL;
        const score = this.thermalScore(x, z);
        if (score <= bestScore) continue;
        bestScore = score;
        best = { x, z, strength };
      }
    if (bestScore < 0.4) best = null;
    this.thermals.set(key, best);
    return best;
  }
  nearbyThermals(x: number, z: number, radiusCells = 2): Thermal[] {
    const cx = Math.floor(x / THERMAL_CELL),
      cz = Math.floor(z / THERMAL_CELL),
      thermals: Thermal[] = [];
    for (let dz = -radiusCells; dz <= radiusCells; dz++)
      for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        const t = this.thermalAtCell(cx + dx, cz + dz);
        if (t) thermals.push(t);
      }
    return thermals;
  }
  thermalsWithin(x: number, z: number, range: number): Thermal[] {
    return range > 0
      ? this.nearbyThermals(x, z, Math.floor(range / THERMAL_CELL) + 1).filter(
          (t) => (t.x - x) ** 2 + (t.z - z) ** 2 <= range * range,
        )
      : [];
  }
  private thermalScore(x: number, z: number): number {
    const sample = this.sample(x, z);
    if (sample.water) return 0;
    const nx = this.sample(x - 28, z).height - this.sample(x + 28, z).height,
      ny = 56,
      nz = this.sample(x, z - 28).height - this.sample(x, z + 28).height;
    const inv = 1 / Math.hypot(nx, ny, nz),
      sun = clamp01(((nx * SUN_OFFSET.x + ny * SUN_OFFSET.y + nz * SUN_OFFSET.z) * inv) / SUN_LENGTH);
    const open = 1 - sample.forest,
      land = (1 - sample.moisture) * 0.4 + open * 0.45 + sun * 0.4 + (1 - ny * inv) * 0.12 + sample.rock * 0.12;
    return (
      land *
      (0.2 + 0.8 * open) *
      blendParameter(sample.biome, 'thermalOdds', 1) *
      (1 - sample.biome.woodland * (1 - sample.glade))
    );
  }
  interest(x: number, z: number): number {
    const center = this.sample(x, z);
    let low = center.height,
      high = low,
      water = center.water,
      open = center.glade,
      closed = open;
    for (const [dx, dz] of [
      [170, 0],
      [-170, 0],
      [0, 170],
      [0, -170],
    ]) {
      const s = this.sample(x + dx!, z + dz!);
      low = Math.min(low, s.height);
      high = Math.max(high, s.height);
      water ||= s.water;
      open = Math.max(open, s.glade);
      closed = Math.min(closed, s.glade);
    }
    return (
      Math.min(1, (high - low) / 120) +
      (water ? 0.8 : 0) +
      center.rock * 0.35 +
      Math.min(center.forest, 1 - center.forest) * 0.5 +
      blendParameter(center.biome, 'scenicBonus', 0) +
      blendParameter(center.biome, 'gladeEdgeScenic', 0) * (open - closed) +
      blendParameter(center.biome, 'torScenic', 0) * smootherstep(0.45, 0.6, center.rock)
    );
  }
  scenicStart(visit: number): { x: number; z: number; heading: number } {
    const ring = 3 + (visit % 9);
    let best = { x: 0, z: 0, heading: 0 },
      score = -Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      const angle = hash2(visit * 8 + candidate, ring, this.seed + 251) * Math.PI * 2,
        radius = ring * 920 + hash2(ring, visit * 8 + candidate, this.seed + 257) * 700;
      const x = Math.cos(angle) * radius,
        z = Math.sin(angle) * radius;
      if (this.sample(x, z).water) continue;
      const s = this.interest(x, z);
      if (s <= score) continue;
      score = s;
      best = { x, z, heading: angle + Math.PI * (0.72 + hash2(visit, candidate, this.seed + 263) * 0.56) };
    }
    if (score === -Infinity)
      for (let step = 1; ; step++) {
        const radius = Math.sqrt(step) * 180,
          angle = step * 2.399963229728653,
          x = Math.cos(angle) * radius,
          z = Math.sin(angle) * radius;
        if (!this.sample(x, z).water) return { x, z, heading: angle };
      }
    return best;
  }
}
export function seedFromText(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value | 0;
}

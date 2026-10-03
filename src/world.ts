import { BIOME_PROFILES, BIOME_SELECTION, WOODLAND_GLADES, biomeWeights, blendParameter, transition, type BiomeWeights } from './biome';

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
  /** Water surface height: the river's level in a river channel, otherwise the lake level. */
  surface: number;
  /** Distance from the nearest river or lake shore; negative inside the water. */
  bank: number;
  moisture: number;
  forest: number;
  rock: number;
  water: boolean;
  river: boolean;
  /** Land dome within a large drainage lake. */
  island?: boolean;
};

export type Thermal = { x: number; z: number; strength: number };
export type Tree = { x: number; y: number; z: number; kind: number; scale: number; turn: number; tint: number; biome: BiomeWeights };

/** Fixed placement azimuth for sun-facing thermal scores. Not the moving sky sun. */
export const SUN_OFFSET = { x: -420, y: 190, z: -300 } as const;
const SUN_LENGTH = Math.hypot(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
const THERMAL_CELL = 1800;
const THERMAL_CANDIDATES = 5;
export const WORLD_CACHE_LIMIT = 20_000;
/**
 * Drainage is decided on this lattice before the terrain is shaped.
 * Far tiles sample every 90 m, so a channel narrower than the far-grid diagonal
 * disappears between vertices. Half-width stays above that diagonal.
 */
export const DRAINAGE_SPACING = 500;
export const MIN_RIVER_HALF_WIDTH = 84;
const MAX_RIVER_HALF_WIDTH = 124;
const RIVER_MIN_FLOW = 4;
const RIVER_MAX_FLOW = 500;
const MIN_LAKE_RADIUS = 175;
const MAX_LAKE_RADIUS = 360;
const SHELF = 150;
const MAX_TREE_SLOPE = 0.6;
const TREE_BANK_CLEARANCE = 18;
/**
 * Captain decision on #85: the world top is about 1,050 m, fly-with-me scale.
 * #87 and #88 share this scale. Snow stays on its current line until #87.
 */
export const WORLD_TOP = 1050;
/** Valley influence before the height scale. Highland valleys multiply this by the relief scale. */
const VALLEY_REACH = 1600;
/** Maximum warped lake plus node jitter, from the previous reach search. */
const MAX_LAKE_REACH = 1470;
/**
 * Massif lift on the current ridge shape. Tuned so sampled crests reach WORLD_TOP.
 * #87 replaces the ridge with a ridged multifractal and keeps this scale.
 */
const MASSIF_LIFT = 1040;
/** Continental warp, matching fly-with-me: about 700 m at a 2.2 km scale. */
const LANDFORM_WARP = 700;
const LANDFORM_WARP_WAVELENGTH = 2200;
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

type RiverNode = {
  i: number;
  j: number;
  x: number;
  z: number;
  elevation: number;
  highland: number;
  lakeland: number;
  level?: number;
  down?: RiverNode | null;
  flow?: number;
  reach?: Reach | null;
  cirque?: Reach | null;
};

/** A river segment, or a lake disc when `lake` is set (then the endpoints coincide). */
export type Reach = {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  aLevel: number;
  bLevel: number;
  aWidth: number;
  bWidth: number;
  meander: number;
  /** Second sideways harmonic, or a lake-outline phase when `lake` is set. */
  bend: number;
  lake: boolean;
  /** Lake ellipse: major radius is aWidth/2; heading follows the basin's spill direction. */
  aspect?: number;
  heading?: number;
  islandRadius?: number;
};

export type DrainageNode = {
  i: number;
  j: number;
  x: number;
  z: number;
  elevation: number;
  level: number;
  flow: number;
  lake: boolean;
  downstreamI: number | null;
  downstreamJ: number | null;
};

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

/** Jittered parcels have different sizes, orientations and polygonal boundaries. */
export function farmland(x: number, z: number, seed: number) {
  const size = 300;
  const cx = Math.floor(x / size);
  const cz = Math.floor(z / size);
  let first = { x: 0, z: 0, distance: Infinity, field: 0 };
  let second = first;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const i = cx + dx;
      const j = cz + dz;
      const sx = (i + 0.2 + hash2(i, j, seed + 153) * 0.6) * size;
      const sz = (j + 0.2 + hash2(i, j, seed + 154) * 0.6) * size;
      const site = { x: sx, z: sz, distance: (x - sx) ** 2 + (z - sz) ** 2, field: hash2(i, j, seed + 156) };
      if (site.distance < first.distance) { second = first; first = site; }
      else if (site.distance < second.distance) second = site;
    }
  }
  const dx = second.x - first.x;
  const dz = second.z - first.z;
  const separation = Math.hypot(dx, dz);
  const distance = (second.distance - first.distance) / (2 * separation);
  return { field: first.field, hedge: 1 - smootherstep(1, 3, distance),
    fieldEdge: distance < 6 ? { x: x + dx / separation * distance,
      z: z + dz / separation * distance, turn: Math.atan2(-dz, dx) } : null };
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

const GRADIENTS = new Float32Array(64 * 2);
for (let index = 0; index < 64; index += 1) {
  const angle = (index / 64) * Math.PI * 2;
  GRADIENTS[index * 2] = Math.cos(angle);
  GRADIENTS[index * 2 + 1] = Math.sin(angle);
}

const fade = (value: number) => value * value * value * (value * (value * 6 - 15) + 10);

/**
 * Gradient (Perlin) noise. The value at a lattice point is zero, but the slope
 * is the gradient, so landforms have no level spot on the lattice. fly-with-me
 * `noise.js` is the reference; appearance noise stays on value noise.
 */
export function gradientNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);
  const dot = (gx: number, gz: number, ox: number, oz: number) => {
    const index = Math.floor(hash2(gx, gz, seed) * 64);
    return GRADIENTS[index * 2]! * ox + GRADIENTS[index * 2 + 1]! * oz;
  };
  const n00 = dot(ix, iz, fx, fz);
  const n10 = dot(ix + 1, iz, fx - 1, fz);
  const n01 = dot(ix, iz + 1, fx, fz - 1);
  const n11 = dot(ix + 1, iz + 1, fx - 1, fz - 1);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 1.6;
}

/** Fractal gradient noise in about [-1, 1]. Landform terms use this, not `fbm`. */
export function gradientFbm(x: number, z: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += gradientNoise(x * frequency, z * frequency, seed + octave * 131) * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / total;
}

/** Wander landform coordinates by about 700 m so ridges and hills do not line up with the axes. */
function warpLandform(x: number, z: number, seed: number): { x: number; z: number } {
  return {
    x: x + LANDFORM_WARP * gradientFbm(x / LANDFORM_WARP_WAVELENGTH + 31.7, z / LANDFORM_WARP_WAVELENGTH - 12.3, seed + 2203, 3),
    z: z + LANDFORM_WARP * gradientFbm(x / LANDFORM_WARP_WAVELENGTH - 54.1, z / LANDFORM_WARP_WAVELENGTH + 77.9, seed + 2210, 3),
  };
}

/**
 * Valley width in full Highlands. Crests stand about 900 m from rivers, so the
 * blend cannot grow by the full 1,050/420 height ratio or the tops disappear.
 * Depth still scales: the floor stays near the water while the landform is taller.
 * Width grows until a crest at 900 m bank still reaches most of its height.
 */
const VALLEY_WIDTH_SCALE = 1.15;
const valleyReliefScale = (highland: number) => 1 + highland * (VALLEY_WIDTH_SCALE - 1);

const nodeKey = (i: number, j: number) => (i + 2 ** 20) * 2 ** 21 + j + 2 ** 20;

function getLru<K, V>(cache: Map<K, V>, key: K): V | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function trimCache<K, V>(cache: Map<K, V>, maxEntries: number): void {
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

const riverHalf = (flow: number) => MIN_RIVER_HALF_WIDTH
  + (MAX_RIVER_HALF_WIDTH - MIN_RIVER_HALF_WIDTH)
  * clamp01(Math.log(flow / RIVER_MIN_FLOW) / Math.log(RIVER_MAX_FLOW / RIVER_MIN_FLOW));
const lakeRadius = (flow: number) => MIN_LAKE_RADIUS
  + (MAX_LAKE_RADIUS - MIN_LAKE_RADIUS) * clamp01(Math.sqrt(flow) / Math.sqrt(120));

/** Sideways offset at a fraction along a reach; zero at both ends. */
export const meanderOffset = (reach: Reach, t: number) => {
  const length = Math.hypot(reach.bx - reach.ax, reach.bz - reach.az);
  return length * (reach.meander * Math.sin(Math.PI * t) + reach.bend * Math.sin(2 * Math.PI * t));
};

/** Outline scale in the lake's local disc/ellipse coordinates. */
const lakeWarp = (reach: Reach, angle: number) => reach.aspect
  ? 1 + 0.05 * Math.sin(3 * angle + reach.bend)
  : Math.max(0.7, 1 + 0.2 * Math.sin(2 * angle + reach.meander) + 0.11 * Math.sin(5 * angle + reach.bend));

/** Shore point at a world-space angle (0 points +x), pushed `outward` metres onto land. */
export function lakeShorePoint(reach: Reach, angle: number, outward = 0): { x: number; z: number } {
  const localAngle = angle - (reach.heading ?? 0);
  const dx = Math.cos(localAngle);
  const dz = Math.sin(localAngle) / (reach.aspect ?? 1);
  const radius = (reach.aWidth / 2) * (reach.aspect
    ? lakeWarp(reach, Math.atan2(dz, dx)) / Math.hypot(dx, dz)
    : lakeWarp(reach, angle)) + outward;
  return { x: reach.ax + Math.cos(angle) * radius, z: reach.az + Math.sin(angle) * radius };
}

function reachDistance(reach: Reach, x: number, z: number): { distance: number; t: number } {
  const dx = reach.bx - reach.ax;
  const dz = reach.bz - reach.az;
  const length = Math.hypot(dx, dz);
  if (length === 0) {
    const angle = reach.heading ?? 0;
    const rx = x - reach.ax;
    const rz = z - reach.az;
    const dx = rx * Math.cos(angle) + rz * Math.sin(angle);
    const dz = (-rx * Math.sin(angle) + rz * Math.cos(angle)) / (reach.aspect ?? 1);
    return { distance: Math.hypot(dx, dz) / lakeWarp(reach, Math.atan2(dz, dx)), t: 0 };
  }
  const along = ((x - reach.ax) * dx + (z - reach.az) * dz) / length;
  const t = clamp01(along / length);
  if (along < 0 || along > length) return { distance: Math.hypot(x - mix(reach.ax, reach.bx, t), z - mix(reach.az, reach.bz, t)), t };
  const side = ((x - reach.ax) * dz - (z - reach.az) * dx) / length;
  return { distance: Math.abs(side - meanderOffset(reach, t)), t };
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Keep transitional/lowland terrain unchanged; apply Highlands fully in its core. */
export const highlandWeight = (region: number): number => transition(0.55, region);

export type WorldCacheSizes = { thermals: number; riverNodes: number; nearbyReaches: number };

export class WorldModel {
  readonly seed: number;
  private readonly thermals = new Map<string, Thermal | null>();
  private readonly riverNodes = new Map<number, RiverNode>();
  private readonly nearbyReaches = new Map<number, Reach[]>();

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  /** Drop the least-recently-used entries from each cache until it meets the cap. */
  trim(maxEntries: number): WorldCacheSizes {
    if (!Number.isInteger(maxEntries) || maxEntries < 0) {
      throw new RangeError('maxEntries must be a non-negative integer');
    }
    trimCache(this.thermals, maxEntries);
    trimCache(this.riverNodes, maxEntries);
    trimCache(this.nearbyReaches, maxEntries);
    return {
      thermals: this.thermals.size,
      riverNodes: this.riverNodes.size,
      nearbyReaches: this.nearbyReaches.size,
    };
  }

  sample(x: number, z: number): LandscapeSample {
    const { mountainRegion, elevation, biome } = this.relief(x, z);
    const highland = biome.highlands;
    // The rendered ground and the drainage lattice read the same continuous landform.
    // None of the landform terms is blended through the 500 m lattice.
    const bare = elevation;
    const detail = fbm(x / 125, z / 125, this.seed + 31, 3) * 4.2 + fbm(x / 46, z / 46, this.seed + 37, 2) * 1.05;
    const reliefScale = valleyReliefScale(highland);

    // The nearest channel owns the valley. A second channel blends in only near a divide,
    // so a higher neighbor cannot lift this river onto a ridge or leave a cliff at the shore.
    // Width and depth scale with the new relief, so a taller massif does not become a slot.
    type Shore = { shoreDist: number; surface: number; lake: boolean; distance: number; half: number; islandDistance?: number; islandRadius?: number };
    let nearest: Shore | null = null;
    let second: Shore | null = null;
    let wet: Shore | null = null;
    const accepted: Shore[] = [];
    const coneOf = (shore: Shore) => {
      const distance = Math.max(0, shore.shoreDist) / reliefScale;
      const gentle = distance * (shore.lake ? 0.05 : 0.075);
      const valley = 0.008 * distance + 0.00032 * Math.max(0, distance - 180) ** 2;
      return shore.surface + mix(gentle, valley, highland);
    };
    const shores = this.reachesNear(x, z).map((reach) => {
      const { distance, t } = reachDistance(reach, x, z);
      const wobble = reach.lake ? 1 : 1 + 0.18 * Math.sin(Math.PI * t);
      const half = mix(reach.aWidth, reach.bWidth, t) / 2 * wobble;
      const surface = mix(reach.aLevel, reach.bLevel, t);
      return { shoreDist: distance - half, surface, lake: reach.lake, distance, half,
        largeLake: reach.lake && half > MAX_LAKE_RADIUS,
        islandDistance: reach.islandRadius ? Math.hypot(x - reach.ax, z - reach.az) : undefined,
        islandRadius: reach.islandRadius };
    });
    for (const original of shores) {
      const shore: Shore = { ...original };
      if (original.largeLake) {
        // Reshape lake shores around higher tributaries and neighboring lakes.
        // Only the lake mask changes; river beds, levels and routing stay unchanged.
        // The old pull (2×shelf + drop×3) was tuned for tens of metres of drop.
        // At the new height that pull erases long lakes and their islands.
        // One shelf plus a short drop term still clears a bank; the valley cone does the rest.
        for (const other of shores) {
          const drop = other.surface - shore.surface;
          if (other === original || drop <= 0.3) continue;
          shore.shoreDist = Math.max(shore.shoreDist, SHELF + 48 + Math.min(drop, 40) - other.shoreDist);
        }
      }
      if (shore.shoreDist > VALLEY_REACH * reliefScale) continue;
      accepted.push(shore);
      if (!nearest || shore.shoreDist < nearest.shoreDist) {
        second = nearest;
        nearest = shore;
      } else if (!second || shore.shoreDist < second.shoreDist) second = shore;
      if (shore.shoreDist <= 0 && (!wet || (shore.lake && !wet.lake) || (shore.lake === wet.lake && shore.shoreDist < wet.shoreDist))) {
        wet = shore;
      }
    }

    let height = bare;
    let bank = nearest?.shoreDist ?? Infinity;
    let surface = nearest?.surface ?? bare;
    if (nearest) {
      const tallDivide = accepted.some((other) => Math.abs(other.surface - nearest.surface) > 80);
      if (!tallDivide) {
        const share = second ? 0.5 * (1 - smootherstep(0, 48, second.shoreDist - nearest.shoreDist)) : 0;
        height = mix(coneOf(nearest), second ? coneOf(second) : coneOf(nearest), share);
      } else {
        // Weight by distance, not by which channel is nearest, so a divide in tall
        // country cannot jump when the nearest channel changes.
        let mixed = 0;
        let weight = 0;
        for (const shore of accepted) {
          const influence = Math.exp(-Math.max(0, shore.shoreDist) / (220 * reliefScale));
          mixed += coneOf(shore) * influence;
          weight += influence;
        }
        height = weight > 0 ? mixed / weight : coneOf(nearest);
      }
      const land = smootherstep(
        mix(280, 380, highland) * reliefScale,
        mix(900, 1050, highland) * reliefScale,
        Math.max(0, nearest.shoreDist),
      );
      height = mix(height, bare, land);
    }
    let river = false;
    let lake = false;
    if (wet) {
      river = !wet.lake;
      lake = wet.lake;
      surface = wet.surface;
      bank = wet.shoreDist;
      const depth = wet.lake ? 3.6 + Math.max(0, wet.half - MAX_LAKE_RADIUS) * 0.025 : 2.7;
      const inward = Math.min(-wet.shoreDist, wet.islandRadius ? Math.max(0, wet.islandDistance! - wet.islandRadius) : Infinity);
      const bowl = !wet.lake ? 1 : wet.half > MAX_LAKE_RADIUS
        ? mix(0.08, 1, smootherstep(0, Math.max(80, wet.half * 0.35), inward))
        : 0.7 + 0.3 * (1 - wet.distance / Math.max(wet.half, 1));
      height = surface - depth * bowl;
    } else if (bank < SHELF && bank > 0) {
      height = Math.max(height, surface + 0.85);
    }
    const detailScale = clamp01((bank - 18) / 80);
    height += detail * detailScale;
    if (wet) height = Math.min(height, surface - 1.5);
    else if (bank < SHELF && bank > 0) height = Math.max(height, surface + 0.85);

    let island = false;
    if (wet?.islandRadius && wet.islandDistance! < wet.islandRadius) {
      island = true;
      river = false;
      lake = false;
      bank = wet.islandRadius - wet.islandDistance!;
      height = surface + 0.85 + 12 * (1 - (wet.islandDistance! / wet.islandRadius) ** 2);
    } else if (wet?.islandRadius) {
      bank = Math.max(bank, wet.islandRadius - wet.islandDistance!);
    }

    let peat = 0;
    const pool = this.peatPool(x, z, biome, bank);
    if (pool) {
      const shore = pool.distance;
      peat = 1 - smootherstep(0, 14, shore);
      surface = pool.surface;
      bank = shore;
      if (shore <= 0) {
        lake = true;
        river = false;
        height = surface - 1.7;
      } else {
        height = mix(surface + 0.85, height, smootherstep(0, 26, shore));
      }
    }

    const riverside = 1 - smootherstep(6, 80, bank);
    const moisture = clamp01(0.5 + fbm(x / 650, z / 650, this.seed + 121, 4) * 0.42 + ((lake || river) ? 0.3 : riverside * 0.22));
    const woodland = biome.highlands > 0 ? fbm(x / 1450, z / 1450, this.seed + 139, 4) * 0.86
      + fbm(x / 290, z / 290, this.seed + 149, 3) * 0.25
      + (moisture - 0.5) * 0.18 : 0;
    const glade = biome.woodland > 0 ? smootherstep(WOODLAND_GLADES.start, WOODLAND_GLADES.end, fbm(x / WOODLAND_GLADES.wavelength, z / WOODLAND_GLADES.wavelength, this.seed + 151, 2)) : 0;
    const { field, hedge, fieldEdge } = biome.hills > 0
      ? farmland(x, z, this.seed) : { field: 0, hedge: 0, fieldEdge: null };
    const legacyForest = Math.max(smootherstep(-0.04, 0.05, woodland), riverside * 0.62) * (1 - mountainRegion * 0.5);
    const forest = (biome.hills * (BIOME_PROFILES.hills.forestDensity + hedge * 0.55) + biome.woodland * BIOME_PROFILES.woodland.forestDensity * (1 - glade)
      + biome.moor * BIOME_PROFILES.moor.forestDensity + biome.highlands * legacyForest
      + biome.lakeland * BIOME_PROFILES.lakeland.forestDensity) * ((river || lake) ? 0 : 1);
    const moorPatch = biome.moor > 0 ? clamp01(0.5 + fbm(x / 250, z / 250, this.seed + 155, 2)) : 0;
    const localHigh = smootherstep(0.6, 2.8, detail);
    const rock = clamp01(biome.highlands * (mountainRegion * 0.74 + smootherstep(96, 170, height))
      + blendParameter(biome, 'rockBias', 0) + biome.moor * localHigh * 0.7);

    return { height, mountainRegion, surface, bank, moisture, forest, rock, water: lake || river, river, biome, glade, field, hedge, fieldEdge, moorPatch, peat, island };
  }

  /**
   * Broad landform. Drainage and the rendered ground share this field, so rivers follow the visible relief.
   * Carved river height never feeds back into biome selection.
   *
   * Three terms, each at its own scale, none passed through the 500 m drainage lattice:
   * lowland (#86 fills the hill term), massif (#87 replaces the ridge), summits (#88).
   */
  private relief(x: number, z: number) {
    // Biome eligibility stays on the unwarped value-noise field. #93 owns selection.
    const broad = fbm(x / 3200, z / 3200, this.seed + 7, 4);
    const mountainRegion = smootherstep(0.04, 0.48, fbm(x / BIOME_SELECTION.reliefWavelength, z / BIOME_SELECTION.reliefWavelength, this.seed + 61, 3));
    const climate = clamp01(0.5 + fbm(x / BIOME_SELECTION.climateWavelength, z / BIOME_SELECTION.climateWavelength, this.seed + 127, 3));
    const dry = 1 - transition(BIOME_SELECTION.moorThreshold, climate);
    const candidate = 65 + broad * 45 + dry * (85 + broad * 15);
    const hillsField = clamp01(0.5 + fbm(x / BIOME_SELECTION.hillsWavelength, z / BIOME_SELECTION.hillsWavelength, this.seed + 129, 3));
    const lakeField = clamp01(0.5 + fbm(x / BIOME_SELECTION.lakeWavelength, z / BIOME_SELECTION.lakeWavelength, this.seed + 131, 4));
    // Lakeland replaces appearance and basin water, not the accepted drainage
    // landform. Both allocations use the same ordered biome rules; the landform
    // allocation reserves no lake territory, exactly as before issue 59.
    const landform = biomeWeights(mountainRegion, climate, candidate, hillsField);
    const biome = biomeWeights(mountainRegion, climate, candidate, hillsField, lakeField);
    const warped = warpLandform(x, z, this.seed);
    const elevation = this.lowlandTerm(warped.x, warped.z, landform)
      + this.massifTerm(warped.x, warped.z, landform, mountainRegion)
      + this.summitTerm(x, z, landform);
    return { elevation, mountainRegion, biome };
  }

  /**
   * Lowland and highland base, on warped gradient noise. #86 adds the 520 m hill
   * term in `lowlandHills`, blended by these same biome weights.
   */
  private lowlandTerm(x: number, z: number, landform: BiomeWeights): number {
    const broad = gradientFbm(x / 3200, z / 3200, this.seed + 7, 4);
    return landform.hills * (BIOME_PROFILES.hills.heightOffset + broad * BIOME_PROFILES.hills.heightAmplitude)
      + landform.woodland * (BIOME_PROFILES.woodland.heightOffset + broad * BIOME_PROFILES.woodland.heightAmplitude)
      + landform.moor * (BIOME_PROFILES.moor.heightOffset + broad * BIOME_PROFILES.moor.heightAmplitude)
      + landform.highlands * (28 + broad * 52)
      + this.lowlandHills(x, z, landform);
  }

  /** #86 seam. The hill term is not part of this ticket. */
  private lowlandHills(_x: number, _z: number, _landform: BiomeWeights): number {
    return 0;
  }

  /**
   * Highland massif. #87 replaces this ridge with a warped ridged multifractal
   * and keeps MASSIF_LIFT, the scale that reaches WORLD_TOP.
   */
  private massifTerm(x: number, z: number, landform: BiomeWeights, mountainRegion: number): number {
    if (landform.highlands === 0) return 0;
    // Wavelength grows with the lift, so this ridge is not a cliff at the new height.
    // #87 replaces the shape and can sharpen it.
    const wavelength = 1550 * (MASSIF_LIFT / 380);
    const ridges = 1 - Math.abs(gradientFbm(x / wavelength, z / wavelength, this.seed + 47, 4));
    const ridge = clamp01((ridges - 0.34) / 0.66);
    return landform.highlands * mountainRegion * ridge * ridge * MASSIF_LIFT;
  }

  /**
   * #88 seam. Pyramid summits use barely warped coordinates, so this term receives
   * the raw point rather than the 700 m landform warp. It is zero until #88.
   */
  private summitTerm(_x: number, _z: number, _landform: BiomeWeights): number {
    return 0;
  }

  /** Small dark pools on genuinely flat, high Moor tops, separate from drainage lakes. */
  private peatPool(x: number, z: number, biome: BiomeWeights, bank: number): { distance: number; surface: number } | null {
    if (biome.moor < 0.98 || bank < 1000) return null;
    const cx = Math.floor(x / 500);
    const cz = Math.floor(z / 500);
    if (hash2(cx, cz, this.seed + 193) > 0.22) return null;
    const centerX = (cx + 0.25 + hash2(cx, cz, this.seed + 194) * 0.5) * 500;
    const centerZ = (cz + 0.25 + hash2(cx, cz, this.seed + 195) * 0.5) * 500;
    const radius = 32 + hash2(cx, cz, this.seed + 196) * 22;
    const distance = Math.hypot(x - centerX, z - centerZ) - radius;
    if (distance > 26) return null;
    const surface = this.relief(centerX, centerZ).elevation - 0.5;
    if (surface < 110 || Math.abs(this.relief(centerX + 36, centerZ).elevation - surface - 0.5) > 2.2
      || Math.abs(this.relief(centerX, centerZ + 36).elevation - surface - 0.5) > 2.2) return null;
    return { distance, surface };
  }

  /** River reaches and lake discs that can shape the ground near a point. */
  reachesNear(x: number, z: number): Reach[] {
    const ci = Math.floor(x / DRAINAGE_SPACING);
    const cj = Math.floor(z / DRAINAGE_SPACING);
    const key = nodeKey(ci, cj);
    let reaches = getLru(this.nearbyReaches, key);
    if (reaches === undefined) {
      // Lowland keeps the old 7-cell search. Steeper country widens it with the valley.
      const margin = this.reachMargin(ci, cj);
      reaches = this.reachesIn(
        (ci - margin) * DRAINAGE_SPACING,
        (cj - margin) * DRAINAGE_SPACING,
        (ci + margin) * DRAINAGE_SPACING,
        (cj + margin) * DRAINAGE_SPACING,
      );
      this.nearbyReaches.set(key, reaches);
    }
    return reaches;
  }

  /** Cells in flat country keep the previous search. Highland cells cover the scaled valley. */
  private reachMargin(ci: number, cj: number): number {
    let highland = 0;
    for (const dx of [0.02, 0.5, 0.98]) {
      for (const dz of [0.02, 0.5, 0.98]) {
        highland = Math.max(highland, this.relief((ci + dx) * DRAINAGE_SPACING, (cj + dz) * DRAINAGE_SPACING).biome.highlands);
      }
    }
    if (highland === 0) return 7;
    return Math.ceil((MAX_LAKE_REACH + VALLEY_REACH * valleyReliefScale(highland)) / DRAINAGE_SPACING) + 1;
  }

  /** Nearest lake disc (basin or cirque) and the distance from its shore; negative inside the water. */
  nearestLake(x: number, z: number): { reach: Reach; shoreDist: number } | null {
    let best: { reach: Reach; shoreDist: number } | null = null;
    for (const reach of this.reachesNear(x, z)) {
      if (!reach.lake) continue;
      const shoreDist = reachDistance(reach, x, z).distance - reach.aWidth / 2;
      if (!best || shoreDist < best.shoreDist) best = { reach, shoreDist };
    }
    return best;
  }

  /** All reaches starting at nodes whose centers lie in a rectangle of world space. */
  reachesIn(minX: number, minZ: number, maxX: number, maxZ: number): Reach[] {
    const reaches: Reach[] = [];
    const i0 = Math.floor(minX / DRAINAGE_SPACING - 0.5);
    const i1 = Math.floor(maxX / DRAINAGE_SPACING - 0.5);
    const j0 = Math.floor(minZ / DRAINAGE_SPACING - 0.5);
    const j1 = Math.floor(maxZ / DRAINAGE_SPACING - 0.5);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const node = this.node(i, j);
        const reach = this.reachFrom(node);
        if (reach) reaches.push(reach);
        const cirque = this.cirqueFrom(node);
        if (cirque) reaches.push(cirque);
      }
    }
    return reaches;
  }

  drainageAt(i: number, j: number): DrainageNode {
    const node = this.node(i, j);
    const down = this.downstream(node);
    const flow = this.flow(node);
    return {
      i,
      j,
      x: node.x,
      z: node.z,
      elevation: node.elevation,
      level: this.waterLevel(node),
      flow,
      lake: !down && flow >= (node.lakeland > 0.5 ? 2 : RIVER_MIN_FLOW),
      downstreamI: down?.i ?? null,
      downstreamJ: down?.j ?? null,
    };
  }

  /** Largest nearby lake, or the largest river node if no lake is in range. */
  landmarkNear(x: number, z: number, radius = 10): { x: number; z: number; surface: number; lake: boolean } | null {
    const ci = Math.round(x / DRAINAGE_SPACING - 0.5);
    const cj = Math.round(z / DRAINAGE_SPACING - 0.5);
    const candidates: DrainageNode[] = [];
    for (let j = cj - radius; j <= cj + radius; j += 1) {
      for (let i = ci - radius; i <= ci + radius; i += 1) {
        const node = this.drainageAt(i, j);
        const useful = node.lake || (node.downstreamI !== null && node.flow >= RIVER_MIN_FLOW);
        if (!useful) continue;
        candidates.push(node);
      }
    }
    candidates.sort((a, b) => Number(b.lake) - Number(a.lake) || b.flow - a.flow);
    for (const node of candidates) {
      const wetPoint = (px: number, pz: number) => {
        const sample = this.sample(px, pz);
        return sample.water && (!node.lake || !sample.river)
          ? { x: px, z: pz, surface: sample.surface, lake: !sample.river } : null;
      };
      const center = wetPoint(node.x, node.z);
      if (center) return center;
      // A lake's center can be an island, or its entire mask can be clipped by
      // higher tributaries. Try actual lake water, then the next visible feature.
      if (!node.lake) continue;
      for (const distance of [300, 600, 900, 1200]) {
        for (let direction = 0; direction < 16; direction += 1) {
          const angle = direction * Math.PI / 8;
          const point = wetPoint(node.x + Math.cos(angle) * distance, node.z + Math.sin(angle) * distance);
          if (point) return point;
        }
      }
    }
    return null;
  }

  /** Four altitude viewpoints: a confluence, a basin lake, a multi-segment run, and a wide network. */
  reviewSpots(): {
    confluence: { x: number; z: number; surface: number };
    lake: { x: number; z: number; surface: number };
    run: { x: number; z: number; surface: number; heading: number };
    network: { x: number; z: number; surface: number };
  } {
    let lake = this.drainageAt(0, 0);
    let confluence = lake;
    let bestInflows = 0;
    const inflows = new Map<string, number>();
    const nodes = [];
    for (let j = -16; j <= 16; j += 1) {
      for (let i = -16; i <= 16; i += 1) {
        const node = this.drainageAt(i, j);
        nodes.push(node);
        if (node.lake && node.flow > lake.flow) lake = node;
        if (node.downstreamI !== null) inflows.set(`${node.downstreamI},${node.downstreamJ}`, (inflows.get(`${node.downstreamI},${node.downstreamJ}`) ?? 0) + 1);
      }
    }
    for (const node of nodes) {
      const count = inflows.get(`${node.i},${node.j}`) ?? 0;
      if (count > bestInflows && node.downstreamI !== null) {
        bestInflows = count;
        confluence = node;
      }
    }
    let runStart = confluence;
    let runEnd = confluence;
    let runSteps = 0;
    for (const node of nodes) {
      if (node.flow < 4 || node.downstreamI === null) continue;
      let current = node;
      let steps = 0;
      let end = node;
      for (let step = 0; step < 8 && current.downstreamI !== null && current.downstreamJ !== null; step += 1) {
        const next = this.drainageAt(current.downstreamI, current.downstreamJ);
        if (next.lake || next.flow < 4) break;
        end = next;
        current = next;
        steps += 1;
      }
      if (steps > runSteps) {
        runSteps = steps;
        runStart = node;
        runEnd = end;
      }
    }
    const heading = Math.atan2(runEnd.x - runStart.x, runEnd.z - runStart.z);
    return {
      confluence: { x: confluence.x, z: confluence.z, surface: confluence.level },
      lake: { x: lake.x, z: lake.z, surface: lake.level },
      run: { x: (runStart.x + runEnd.x) / 2, z: (runStart.z + runEnd.z) / 2, surface: (runStart.level + runEnd.level) / 2, heading },
      network: { x: confluence.x, z: confluence.z, surface: confluence.level },
    };
  }

  private reachFrom(node: RiverNode): Reach | null {
    if (node.reach !== undefined) return node.reach;
    node.reach = null;
    const flow = this.flow(node);
    const down = this.downstream(node);
    if (flow < (!down && node.lakeland > 0.5 ? 2 : RIVER_MIN_FLOW)) return null;
    const level = this.waterLevel(node);
    if (!down) {
      const radius = this.lakeRadius(node, flow);
      node.reach = {
        ax: node.x, az: node.z, bx: node.x, bz: node.z,
        aLevel: level, bLevel: level,
        aWidth: radius * 2, bWidth: radius * 2,
        meander: hash2(node.i, node.j, this.seed + 181) * Math.PI * 2,
        bend: hash2(node.i, node.j, this.seed + 183) * Math.PI * 2,
        lake: true,
        ...(node.lakeland > 0.5 ? this.lakeShape(node, radius) : {}),
      };
      return node.reach;
    }
    const downLevel = this.waterLevel(down);
    let bx = down.x;
    let bz = down.z;
    const downFlow = this.flow(down);
    if (!this.downstream(down) && downFlow >= RIVER_MIN_FLOW) {
      // Keep the accepted inlet geometry. The enlarged lake mask reshapes itself
      // around tributaries instead of shortening their channels to zero length.
      const radius = this.inletRadius(down, downFlow);
      const dx = down.x - node.x;
      const dz = down.z - node.z;
      const length = Math.hypot(dx, dz);
      const scale = length === 0 ? 0 : Math.max(0, length - radius) / length;
      bx = node.x + dx * scale;
      bz = node.z + dz * scale;
    }
    node.reach = {
      ax: node.x, az: node.z, bx, bz,
      aLevel: level, bLevel: downLevel,
      aWidth: riverHalf(flow) * 2,
      bWidth: riverHalf(Math.max(flow, downFlow)) * 2,
      ...this.channelBend(node, down),
      lake: false,
    };
    return node.reach;
  }

  /** A small headwater bowl feeds the first mapped river, at that river's level. */
  private cirqueFrom(node: RiverNode): Reach | null {
    if (node.cirque !== undefined) return node.cirque;
    node.cirque = null;
    if (node.highland < 0.5 || node.elevation < 180
      || this.flow(node) < RIVER_MIN_FLOW || !this.downstream(node)
      || this.upstreams(node).some((up) => this.flow(up) >= RIVER_MIN_FLOW)) return null;
    const level = this.waterLevel(node);
    const radius = this.lakeRadius(node, this.flow(node));
    node.cirque = {
      ax: node.x, az: node.z, bx: node.x, bz: node.z,
      aLevel: level, bLevel: level, aWidth: radius * 2, bWidth: radius * 2,
      meander: hash2(node.i, node.j, this.seed + 181) * Math.PI * 2,
      bend: hash2(node.i, node.j, this.seed + 183) * Math.PI * 2,
      lake: true,
    };
    return node.cirque;
  }

  /** Basin lakes stretch along the lowest potential spill, without changing river routing. */
  private lakeShape(node: RiverNode, radius: number) {
    let spill = this.node(node.i + 1, node.j);
    for (const [di, dj] of NEIGHBORS) {
      const other = this.node(node.i + di, node.j + dj);
      if (other.elevation < spill.elevation) spill = other;
    }
    return { heading: Math.atan2(spill.z - node.z, spill.x - node.x),
      aspect: 0.42 + hash2(node.i, node.j, this.seed + 185) * 0.16,
      islandRadius: radius >= 900 ? 160 + hash2(node.i, node.j, this.seed + 187) * 80 : undefined };
  }

  private lakeRadius(node: RiverNode, flow: number): number {
    return mix(this.inletRadius(node, flow), 750 + 650 * clamp01(Math.sqrt(flow / 80)), node.lakeland);
  }

  private inletRadius(node: RiverNode, flow: number): number {
    return mix(lakeRadius(flow), 140 + Math.min(60, Math.sqrt(flow) * 5), node.highland);
  }

  private node(i: number, j: number): RiverNode {
    const key = nodeKey(i, j);
    let node = getLru(this.riverNodes, key);
    if (node !== undefined) return node;
    const x = (i + 0.5 + (hash2(i, j, this.seed + 163) - 0.5) * 0.42) * DRAINAGE_SPACING;
    const z = (j + 0.5 + (hash2(i, j, this.seed + 167) - 0.5) * 0.42) * DRAINAGE_SPACING;
    const { elevation, biome } = this.relief(x, z);
    node = { i, j, x, z, elevation, highland: biome.highlands, lakeland: biome.lakeland };
    this.riverNodes.set(key, node);
    return node;
  }

  /**
   * Signed bend fractions. The curve is zero at both lattice nodes, so seams and confluences stay put,
   * and large enough that a segment does not read as a straight cut from altitude.
   * If that curve would cross a neighbor, the deterministically lesser reach is pulled back.
   */
  private baseBend(node: RiverNode, down: RiverNode): { meander: number; bend: number } {
    const dx = down.x - node.x;
    const dz = down.z - node.z;
    const length = Math.hypot(dx, dz) || 1;
    const midX = (node.x + down.x) / 2;
    const midZ = (node.z + down.z) / 2;
    const left = this.relief(midX - dz / length * 160, midZ + dx / length * 160).elevation;
    const right = this.relief(midX + dz / length * 160, midZ - dx / length * 160).elevation;
    const sign = left === right ? (hash2(node.i, node.j, this.seed + 179) < 0.5 ? -1 : 1) : left < right ? 1 : -1;
    return {
      meander: sign * (0.06 + hash2(node.i, node.j, this.seed + 181) * 0.03),
      bend: (hash2(node.i, node.j, this.seed + 183) - 0.5) * 0.05,
    };
  }

  private channelBend(node: RiverNode, down: RiverNode): { meander: number; bend: number } {
    const own = this.baseBend(node, down);
    const rivals = this.upstreams(down).filter((other) => other !== node && this.flow(other) >= RIVER_MIN_FLOW);
    let scale = 1;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const hit = rivals.some((other) => {
        const theirs = this.baseBend(other, down);
        return this.curvesCross(
          node, down, own.meander * scale, own.bend * scale,
          other, down, theirs.meander * scale, theirs.bend * scale,
        );
      });
      if (!hit) break;
      scale *= 0.45;
    }
    return { meander: own.meander * scale, bend: own.bend * scale };
  }

  private mouth(from: RiverNode, to: RiverNode): { x: number; z: number } {
    const flow = this.flow(to);
    if (!this.downstream(to) && flow >= RIVER_MIN_FLOW) {
      const radius = this.inletRadius(to, flow);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const length = Math.hypot(dx, dz) || 1;
      const scale = Math.max(0, length - radius) / length;
      return { x: from.x + dx * scale, z: from.z + dz * scale };
    }
    return { x: to.x, z: to.z };
  }

  private curvesCross(
    aFrom: RiverNode, aTo: RiverNode, aMeander: number, aBend: number,
    bFrom: RiverNode, bTo: RiverNode, bMeander: number, bBend: number,
  ): boolean {
    const aEnd = this.mouth(aFrom, aTo);
    const bEnd = this.mouth(bFrom, bTo);
    const points = (ax: number, az: number, bx: number, bz: number, meander: number, bend: number) => {
      const reach = { ax, az, bx, bz, aLevel: 0, bLevel: 0, aWidth: 0, bWidth: 0, meander, bend, lake: false };
      return Array.from({ length: 9 }, (_, k) => {
        const t = k / 8;
        const length = Math.hypot(bx - ax, bz - az) || 1;
        const offset = meanderOffset(reach, t);
        return [
          ax + (bx - ax) * t + offset * (bz - az) / length,
          az + (bz - az) * t - offset * (bx - ax) / length,
        ] as const;
      });
    };
    const a = points(aFrom.x, aFrom.z, aEnd.x, aEnd.z, aMeander, aBend);
    const b = points(bFrom.x, bFrom.z, bEnd.x, bEnd.z, bMeander, bBend);
    const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    for (let p = 0; p < 8; p += 1) {
      for (let q = 0; q < 8; q += 1) {
        const [a0, a1, b0, b1] = [a[p]!, a[p + 1]!, b[q]!, b[q + 1]!];
        if (Math.hypot(a0[0] - b0[0], a0[1] - b0[1]) < 1 || Math.hypot(a1[0] - b1[0], a1[1] - b1[1]) < 1) continue;
        if (side(a0[0], a0[1], a1[0], a1[1], b0[0], b0[1]) * side(a0[0], a0[1], a1[0], a1[1], b1[0], b1[1]) < 0
          && side(b0[0], b0[1], b1[0], b1[1], a0[0], a0[1]) * side(b0[0], b0[1], b1[0], b1[1], a1[0], a1[1]) < 0) return true;
      }
    }
    return false;
  }

  private slopeTo(from: RiverNode, to: RiverNode): number {
    const drop = from.elevation - to.elevation;
    if (drop <= 0) return 0;
    return drop / Math.hypot(to.x - from.x, to.z - from.z);
  }

  /** Strictly lowest neighbor. Cardinal-only is used when a diagonal would cross another. */
  private steepest(node: RiverNode, cardinalOnly = false): RiverNode | null {
    let best: RiverNode | null = null;
    let bestSlope = 0;
    for (let k = 0; k < NEIGHBORS.length; k += 1) {
      const [di, dj] = NEIGHBORS[k]!;
      if (cardinalOnly && di !== 0 && dj !== 0) continue;
      const other = this.node(node.i + di, node.j + dj);
      const slope = this.slopeTo(node, other);
      if (slope > bestSlope) {
        bestSlope = slope;
        best = other;
      }
    }
    return best;
  }

  /**
   * Downstream neighbor. Two diagonals can cross inside one grid square; the gentler
   * one takes its lowest cardinal instead, so the network stays downhill and does not cross.
   */
  private downstream(node: RiverNode): RiverNode | null {
    if (node.down !== undefined) return node.down;
    let down = this.steepest(node);
    if (down && down.i !== node.i && down.j !== node.j) {
      const sideA = this.node(down.i, node.j);
      const sideB = this.node(node.i, down.j);
      const rival = this.steepest(sideA) === sideB ? sideA : this.steepest(sideB) === sideA ? sideB : null;
      if (rival) {
        const rivalDown = rival === sideA ? sideB : sideA;
        const own = this.slopeTo(node, down);
        const other = this.slopeTo(rival, rivalDown);
        if (own < other || (own === other && hash2(node.i, node.j, this.seed + 173) <= hash2(rival.i, rival.j, this.seed + 173))) {
          down = this.steepest(node, true);
        }
      }
    }
    node.down = down;
    return down;
  }

  /** Nodes that drain directly into this one. */
  private upstreams(node: RiverNode): RiverNode[] {
    const upstream: RiverNode[] = [];
    for (const [di, dj] of NEIGHBORS) {
      const other = this.node(node.i + di, node.j + dj);
      if (this.downstream(other) === node) upstream.push(other);
    }
    return upstream;
  }

  /**
   * Upstream drainage count, cached per node. Walks only this basin, so a region query
   * does not precompute the world. The cap bounds a pathological basin.
   */
  private flow(node: RiverNode): number {
    if (node.flow !== undefined) return node.flow;
    const frames: Array<{ node: RiverNode; ups: RiverNode[]; index: number }> = [];
    frames.push({ node, ups: this.upstreams(node), index: 0 });
    let guard = 0;
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      if (frame.node.flow !== undefined) {
        frames.pop();
        continue;
      }
      if (frame.index < frame.ups.length && guard < 4000) {
        const up = frame.ups[frame.index]!;
        frame.index += 1;
        if (up.flow === undefined) {
          frames.push({ node: up, ups: this.upstreams(up), index: 0 });
          guard += 1;
        }
        continue;
      }
      let flow = 1;
      for (const up of frame.ups) flow += up.flow ?? 1;
      frame.node.flow = Math.min(flow, RIVER_MAX_FLOW);
      frames.pop();
    }
    return node.flow ?? 1;
  }

  private waterLevel(node: RiverNode, guard = 0): number {
    if (node.level !== undefined) return node.level;
    const down = this.downstream(node);
    if (!down || guard > 512) {
      node.level = node.elevation;
      return node.level;
    }
    const below = this.waterLevel(down, guard + 1);
    node.level = below + Math.max(0.45, node.elevation - down.elevation);
    return node.level;
  }

  /** World-space grid keeps positions and density independent of chunk partitioning. */
  treesInArea(minX: number, minZ: number, size: number, spacing: number): Tree[] {
    const build = this.buildTreesInArea(minX, minZ, size, spacing);
    let result = build.next();
    while (!result.done) result = build.next();
    return result.value;
  }

  /** Same placement as treesInArea, with a scheduling boundary between lattice rows. */
  *buildTreesInArea(minX: number, minZ: number, size: number, spacing: number): Generator<void, Tree[]> {
    const trees: Tree[] = [];
    for (let cz = Math.floor(minZ / spacing); cz <= Math.floor((minZ + size) / spacing); cz += 1) {
      for (let cx = Math.floor(minX / spacing); cx <= Math.floor((minX + size) / spacing); cx += 1) {
        const x = (cx + 0.15 + hash2(cx, cz, this.seed + 337) * 0.7) * spacing;
        const z = (cz + 0.15 + hash2(cx, cz, this.seed + 347) * 0.7) * spacing;
        if (x < minX || x >= minX + size || z < minZ || z >= minZ + size) continue;
        const sample = this.sample(x, z);
        const clumping = sample.biome.highlands > 0 ? 0.5 + fbm(x / 120, z / 120, this.seed + 157, 2) * 1.2 : 0;
        const density = blendParameter(sample.biome, 'treeDensity', 1);
        const groveX = Math.floor(x / 1000);
        const groveZ = Math.floor(z / 1000);
        const groveCenterX = (groveX + 0.3 + hash2(groveX, groveZ, this.seed + 158) * 0.4) * 1000;
        const groveCenterZ = (groveZ + 0.3 + hash2(groveX, groveZ, this.seed + 159) * 0.4) * 1000;
        const moorGrove = hash2(groveX, groveZ, this.seed + 160) < 0.25
          ? 1 - smootherstep(100, 150, Math.hypot(x - groveCenterX, z - groveCenterZ)) : 0;
        const chance = sample.biome.hills * (0.018 + sample.hedge * 0.45)
          // A 0.35 reference occupancy leaves headroom for the full 2.5× profile density.
          + sample.biome.woodland * (1 - sample.glade) * 0.35 * density
          + sample.biome.moor * (0.004 + moorGrove * 0.3)
          + sample.biome.highlands * (0.018 + sample.forest * clumping)
          + sample.biome.lakeland * (sample.island ? 0.5 : 0.2);
        if (sample.water || (sample.height >= 320 && sample.biome.highlands > 0.5)
          || sample.rock > mix(0.72, 1, sample.biome.highlands)
          || hash2(cx, cz, this.seed + 349) > chance * (1 - sample.biome.highlands * smootherstep(280, 320, sample.height))) continue;
        if (sample.bank < TREE_BANK_CLEARANCE) continue;
        const slope = Math.hypot(this.sample(x + 3, z).height - sample.height, this.sample(x, z + 3).height - sample.height) / 3;
        if (slope > MAX_TREE_SLOPE) continue;
        const reserved = sample.biome.lakeland;
        const conifer = sample.biome.hills * BIOME_PROFILES.hills.species[0] + sample.biome.woodland * BIOME_PROFILES.woodland.species[0]
          + sample.biome.moor * BIOME_PROFILES.moor.species[0] + sample.biome.highlands + reserved * BIOME_PROFILES.lakeland.species[0];
        const birch = sample.biome.hills * BIOME_PROFILES.hills.species[2] + sample.biome.woodland * BIOME_PROFILES.woodland.species[2]
          + sample.biome.moor * BIOME_PROFILES.moor.species[2] + reserved * BIOME_PROFILES.lakeland.species[2];
        const species = hash2(cx, cz, this.seed + 353);
        const kind = species < conifer ? 0 : species > 1 - birch ? 2 : 1;
        const autumn = hash2(cx, cz, this.seed + 355) < sample.biome.woodland * 0.04;
        const tint = autumn ? (hash2(cx, cz, this.seed + 356) < 0.25 ? 0xd9a441 : 0xc9772e)
          : kind === 2 ? 0x9dbf4e : kind === 0 ? 0x1f5a34
          : sample.biome.woodland > hash2(cx, cz, this.seed + 358)
            ? BIOME_PROFILES.woodland.palette[Math.floor(hash2(cx, cz, this.seed + 357) * 3)]! : 0x2e7a3e;
        trees.push({
          x, y: sample.height, z, kind, tint, biome: sample.biome,
          scale: (0.8 + hash2(cx, cz, this.seed + 359) * 0.4) * blendParameter(sample.biome, 'crownScale', 1),
          turn: hash2(cx, cz, this.seed + 361) * Math.PI * 2,
        });
      }
      yield;
    }
    return trees;
  }

  thermalAtCell(cellX: number, cellZ: number): Thermal | null {
    const key = `${cellX},${cellZ}`;
    const cached = getLru(this.thermals, key);
    if (cached !== undefined) return cached;
    let best: Thermal | null = null;
    let bestScore = 0;
    const strength = 0.72 + hash2(cellX, cellZ, this.seed + 227) * 0.72;
    for (let iz = 0; iz < THERMAL_CANDIDATES; iz += 1) {
      for (let ix = 0; ix < THERMAL_CANDIDATES; ix += 1) {
        const gx = cellX * THERMAL_CANDIDATES + ix;
        const gz = cellZ * THERMAL_CANDIDATES + iz;
        const x = (cellX + (ix + 0.18 + hash2(gx, gz, this.seed + 211) * 0.64) / THERMAL_CANDIDATES) * THERMAL_CELL;
        const z = (cellZ + (iz + 0.18 + hash2(gx, gz, this.seed + 223) * 0.64) / THERMAL_CANDIDATES) * THERMAL_CELL;
        const score = this.thermalScore(x, z);
        if (score <= bestScore) continue;
        bestScore = score;
        best = { x, z, strength };
      }
    }
    if (bestScore < 0.4) best = null;
    this.thermals.set(key, best);
    return best;
  }

  nearbyThermals(x: number, z: number, radiusCells = 2): Thermal[] {
    const centerX = Math.floor(x / THERMAL_CELL);
    const centerZ = Math.floor(z / THERMAL_CELL);
    const thermals: Thermal[] = [];
    for (let dz = -radiusCells; dz <= radiusCells; dz += 1) {
      for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
        const thermal = this.thermalAtCell(centerX + dx, centerZ + dz);
        if (thermal) thermals.push(thermal);
      }
    }
    return thermals;
  }

  /** Thermals whose current position is within `range` meters. Cell scan covers the full disk. */
  thermalsWithin(x: number, z: number, range: number): Thermal[] {
    if (!(range > 0)) return [];
    const cells = Math.floor(range / THERMAL_CELL) + 1;
    const rangeSq = range * range;
    return this.nearbyThermals(x, z, cells).filter((thermal) => {
      const dx = thermal.x - x;
      const dz = thermal.z - z;
      return dx * dx + dz * dz <= rangeSq;
    });
  }

  /** Dry, open, sun-facing ground scores high; forest is low; water is zero. */
  private thermalScore(x: number, z: number): number {
    const sample = this.sample(x, z);
    if (sample.water) return 0;
    const step = 28;
    const nx = this.sample(x - step, z).height - this.sample(x + step, z).height;
    const ny = step * 2;
    const nz = this.sample(x, z - step).height - this.sample(x, z + step).height;
    const invLength = 1 / Math.hypot(nx, ny, nz);
    const sunFacing = clamp01((nx * SUN_OFFSET.x + ny * SUN_OFFSET.y + nz * SUN_OFFSET.z) * invLength / SUN_LENGTH);
    const dry = 1 - sample.moisture;
    const open = 1 - sample.forest;
    const slope = 1 - ny * invLength;
    const land = dry * 0.4 + open * 0.45 + sunFacing * 0.4 + slope * 0.12 + sample.rock * 0.12;
    return land * (0.2 + 0.8 * open) * blendParameter(sample.biome, 'thermalOdds', 1)
      * (1 - sample.biome.woodland * (1 - sample.glade));
  }

  interest(x: number, z: number): number {
    const center = this.sample(x, z);
    let low = center.height;
    let high = center.height;
    let water = center.water;
    let openGlade = center.glade;
    let closedGlade = center.glade;
    for (const [dx, dz] of [[170, 0], [-170, 0], [0, 170], [0, -170]] as const) {
      const around = this.sample(x + dx, z + dz);
      low = Math.min(low, around.height);
      high = Math.max(high, around.height);
      water ||= around.water;
      openGlade = Math.max(openGlade, around.glade);
      closedGlade = Math.min(closedGlade, around.glade);
    }
    // Per-biome features: a glade edge has open glade and closed canopy in reach; a tor sits on the moor's high rock mask.
    const gladeEdge = openGlade - closedGlade;
    const tor = smootherstep(0.45, 0.6, center.rock);
    return Math.min(1, (high - low) / 120) + (water ? 0.8 : 0) + center.rock * 0.35 + Math.min(center.forest, 1 - center.forest) * 0.5
      + blendParameter(center.biome, 'scenicBonus', 0)
      + blendParameter(center.biome, 'gladeEdgeScenic', 0) * gladeEdge + blendParameter(center.biome, 'torScenic', 0) * tor;
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
      if (this.sample(x, z).water) continue;
      const score = this.interest(x, z);
      if (score <= bestScore) continue;
      bestScore = score;
      best = { x, z, heading: angle + Math.PI * (0.72 + hash2(visit, candidate, this.seed + 263) * 0.56) };
    }
    // If every ring candidate is flooded, find dry ground on a deterministic spiral.
    if (bestScore === -Infinity) {
      for (let step = 1; ; step += 1) {
        const radius = Math.sqrt(step) * 180;
        const angle = step * 2.399963229728653;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (!this.sample(x, z).water) return { x, z, heading: angle };
      }
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

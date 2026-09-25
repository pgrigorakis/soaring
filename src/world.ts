export type LandscapeSample = {
  height: number;
  /** Water surface height: the river's level in a river channel, otherwise the lake level. */
  surface: number;
  /** Distance from the nearest river channel's edge; negative inside it. */
  bank: number;
  moisture: number;
  forest: number;
  rock: number;
  water: boolean;
  river: boolean;
};

export type Thermal = { x: number; z: number; strength: number };
export type Tree = { x: number; y: number; z: number; kind: number; scale: number; turn: number };

/** Fixed placement azimuth for sun-facing thermal scores. Not the moving sky sun. */
export const SUN_OFFSET = { x: -420, y: 190, z: -300 } as const;
const SUN_LENGTH = Math.hypot(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
const THERMAL_CELL = 1100;
const THERMAL_CANDIDATES = 5;
// Rivers follow steepest descent between jittered nodes of a coarse grid.
const RIVER_CELL = 200;
const RIVER_JITTER = 0.3;
const RIVER_MEANDER = 0.06;
const RIVER_MIN_FLOW = 14;
const RIVER_MAX_FLOW = 600;
const BANK_SLOPE = 0.12;
const MAX_TREE_SLOPE = 0.6;
// One detailed terrain quad: water is drawn on every quad that touches a channel vertex.
const TREE_BANK_CLEARANCE = 9;
// Half the diagonal of a detailed terrain quad: narrower channels would slip between terrain vertices and vanish.
const MIN_WATER_HALF_WIDTH = 6.5;
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

type RiverNode = {
  i: number; j: number; x: number; z: number; elevation: number; level: number;
  down?: RiverNode | null; flow?: number; reach?: Reach | null;
};
/** A straight river reach from a node to its downstream node, bent by a gentle meander. */
export type Reach = {
  ax: number; az: number; bx: number; bz: number;
  aLevel: number; bLevel: number; aWidth: number; bWidth: number; meander: number;
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

const nodeKey = (i: number, j: number) => (i + 2 ** 20) * 2 ** 21 + j + 2 ** 20;
const riverWidth = (flow: number) =>
  7 + 31 * clamp01(Math.log(flow / RIVER_MIN_FLOW) / Math.log(RIVER_MAX_FLOW / RIVER_MIN_FLOW));

/** Sideways meander offset at a fraction along a reach; zero at both ends. */
export const meanderOffset = (reach: Reach, t: number) =>
  reach.meander * Math.hypot(reach.bx - reach.ax, reach.bz - reach.az) * Math.sin(Math.PI * t);

function reachDistance(reach: Reach, x: number, z: number): { distance: number; t: number } {
  const dx = reach.bx - reach.ax;
  const dz = reach.bz - reach.az;
  const length = Math.hypot(dx, dz);
  if (length === 0) return { distance: Math.hypot(x - reach.ax, z - reach.az), t: 0 };
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

export class WorldModel {
  readonly seed: number;
  readonly waterLevel = 2;
  private readonly thermals = new Map<string, Thermal | null>();
  private readonly riverNodes = new Map<number, RiverNode>();
  private readonly nearbyReaches = new Map<number, Reach[]>();

  constructor(seed: number) {
    this.seed = seed | 0;
  }

  sample(x: number, z: number): LandscapeSample {
    const { land, lake, lakeShape, mountainRegion, detail } = this.land(x, z);

    // Shape terrain toward each nearby river's profile: a channel below the water, a bank just above it,
    // a floodplain, and a valley that widens with the river and with how far the land must be cut.
    // Where valleys overlap, the nearest channel dominates, so a neighbor's bank never fills a channel.
    let blend = 0;
    let shift = 0;
    let surfaceSum = 0;
    let bank = Infinity;
    for (const reach of this.reachesNear(x, z)) {
      const { distance, t } = reachDistance(reach, x, z);
      const width = mix(reach.aWidth, reach.bWidth, t);
      const surface = mix(reach.aLevel, reach.bLevel, t);
      const channel = Math.max(width / 2, MIN_WATER_HALF_WIDTH);
      bank = Math.min(bank, distance - channel);
      // The bank crosses the water surface exactly at the channel edge, over more than a terrain quad.
      const floor = surface + 1;
      const target = Math.max(surface - 1.2 - width * 0.06, Math.min(floor, surface + (distance - channel) * BANK_SLOPE));
      // A floodplain at bank height keeps low land from dipping under the water drawn beside the channel.
      const plain = channel + 1 / BANK_SLOPE + 12 + width * 0.5;
      const weight = 1 - smootherstep(plain, plain + 25 + width * 1.5 + Math.abs(land - floor) * 2.4, distance);
      if (weight <= 0) continue;
      const strength = weight * Math.exp(-Math.max(0, distance - channel) / 6);
      blend += strength;
      shift += strength * weight * (target - land);
      surfaceSum += strength * surface;
    }
    const river = bank < 0;
    let height = blend > 0 ? land + shift / blend : land;
    if (lake) height = Math.min(height, this.waterLevel - 3.5 - lakeShape * 3);
    const surface = river && !lake ? surfaceSum / blend : this.waterLevel;

    const riverside = 1 - smootherstep(2, 45, bank);
    const moisture = clamp01(0.58 + fbm(x / 650, z / 650, this.seed + 121, 4) * 0.42 + (lake || river ? 0.3 : riverside * 0.2));
    // Broad clearings and grove-scale variation, with a narrow transition for visible forest edges.
    const woodland = fbm(x / 1450, z / 1450, this.seed + 139, 4) * 0.86
      + fbm(x / 290, z / 290, this.seed + 149, 3) * 0.25
      + (moisture - 0.5) * 0.18;
    const forest = Math.max(smootherstep(-0.04, 0.05, woodland), riverside * 0.8) * (1 - mountainRegion * 0.45);
    const rock = clamp01(mountainRegion * 0.75 + smootherstep(74, 148, height) + Math.abs(detail) * 0.2);

    return { height, surface, bank, moisture, forest, rock, water: lake || river || height < this.waterLevel, river };
  }

  private land(x: number, z: number) {
    const broad = fbm(x / 2200, z / 2200, this.seed + 7, 4);
    const rolling = fbm(x / 430, z / 430, this.seed + 19, 5);
    const detail = fbm(x / 115, z / 115, this.seed + 31, 3);
    const ridges = 1 - Math.abs(fbm(x / 1050, z / 1050, this.seed + 47, 5));
    const mountainRegion = smootherstep(0.08, 0.52, broad + fbm(x / 4300, z / 4300, this.seed + 59, 3) * 0.42);
    const mountains = mountainRegion * Math.pow(clamp01((ridges - 0.42) / 0.58), 2) * 185;
    const lakeNoise = fbm(x / 540, z / 540, this.seed + 83, 4);
    const lakeGate = fbm(x / 1700, z / 1700, this.seed + 97, 3);
    const lakeShape = smootherstep(0.57, 0.72, lakeNoise) * smootherstep(-0.15, 0.25, lakeGate);
    const lake = lakeShape > 0.58;
    const land = 18 + broad * 35 + rolling * 22 + detail * 4 + mountains - lakeShape * 48;
    return { land, lake, lakeShape, mountains, mountainRegion, detail };
  }

  /** River reaches (node to downstream node, or a pond at a sink) that can shape the ground near a point. */
  reachesNear(x: number, z: number): Reach[] {
    const ci = Math.floor(x / RIVER_CELL);
    const cj = Math.floor(z / RIVER_CELL);
    const key = nodeKey(ci, cj);
    let reaches = this.nearbyReaches.get(key);
    if (!reaches) {
      reaches = this.reachesIn((ci - 2) * RIVER_CELL, (cj - 2) * RIVER_CELL, (ci + 2) * RIVER_CELL, (cj + 2) * RIVER_CELL);
      this.nearbyReaches.set(key, reaches);
    }
    return reaches;
  }

  /** All reaches starting at nodes in a rectangle of world space. */
  reachesIn(minX: number, minZ: number, maxX: number, maxZ: number): Reach[] {
    const reaches: Reach[] = [];
    for (let j = Math.floor(minZ / RIVER_CELL); j <= Math.floor(maxZ / RIVER_CELL); j += 1) {
      for (let i = Math.floor(minX / RIVER_CELL); i <= Math.floor(maxX / RIVER_CELL); i += 1) {
        const reach = this.reachFrom(this.node(i, j));
        if (reach) reaches.push(reach);
      }
    }
    return reaches;
  }

  private reachFrom(node: RiverNode): Reach | null {
    if (node.reach !== undefined) return node.reach;
    node.reach = null;
    const flow = this.flow(node);
    if (flow < RIVER_MIN_FLOW) return null;
    const down = this.downstream(node);
    const aWidth = riverWidth(flow);
    if (!down) {
      // A river that reaches a local low point ends in a pond.
      const size = 20 + aWidth * 2.4;
      node.reach = { ax: node.x, az: node.z, bx: node.x, bz: node.z, aLevel: node.level, bLevel: node.level, aWidth: size, bWidth: size, meander: 0 };
    } else {
      node.reach = {
        ax: node.x, az: node.z, bx: down.x, bz: down.z,
        aLevel: node.level, bLevel: down.level,
        aWidth, bWidth: riverWidth(this.flow(down)),
        meander: (hash2(node.i, node.j, this.seed + 181) - 0.5) * 2 * RIVER_MEANDER,
      };
    }
    return node.reach;
  }

  private node(i: number, j: number): RiverNode {
    const key = nodeKey(i, j);
    let node = this.riverNodes.get(key);
    if (node) return node;
    const x = (i + 0.5 + (hash2(i, j, this.seed + 163) - 0.5) * RIVER_JITTER) * RIVER_CELL;
    const z = (j + 0.5 + (hash2(i, j, this.seed + 167) - 0.5) * RIVER_JITTER) * RIVER_CELL;
    const { lake, lakeShape, mountains } = this.land(x, z);
    // Rivers route over the broad landform; smaller hills would trap them in countless hollows.
    // Valley carving absorbs the difference.
    const drainage = 18 + fbm(x / 2200, z / 2200, this.seed + 7, 2) * 35 + mountains - lakeShape * 48;
    const elevation = lake ? Math.min(drainage, this.waterLevel - 3.5 - lakeShape * 3) : drainage;
    node = { i, j, x, z, elevation, level: Math.max(this.waterLevel, elevation - 1.5) };
    this.riverNodes.set(key, node);
    return node;
  }

  /** Steepest strictly lower of the eight neighbors, ignoring crossings. */
  private steepest(node: RiverNode, cardinalOnly = false): RiverNode | null {
    let best: RiverNode | null = null;
    let bestSlope = 0;
    for (let k = 0; k < NEIGHBORS.length; k += 1) {
      const [di, dj] = NEIGHBORS[k]!;
      if (cardinalOnly && di !== 0 && dj !== 0) continue;
      const other = this.node(node.i + di, node.j + dj);
      // A per-node random preference bends rivers away from the grid axes on smooth slopes.
      const slope = (node.elevation - other.elevation) / Math.hypot(other.x - node.x, other.z - node.z)
        * (0.4 + 1.2 * hash2(node.i * 8 + k, node.j, this.seed + 191));
      if (slope > bestSlope) { bestSlope = slope; best = other; }
    }
    return best;
  }

  /**
   * Downstream neighbor. Two diagonals can only cross inside the same grid square; the gentler one
   * falls back to its best cardinal neighbor, so no two reaches cross.
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
        const own = (node.elevation - down.elevation) / Math.hypot(down.x - node.x, down.z - node.z);
        const other = (rival.elevation - rivalDown.elevation) / Math.hypot(rivalDown.x - rival.x, rivalDown.z - rival.z);
        if (own < other || (own === other && hash2(node.i, node.j, this.seed + 173) < hash2(rival.i, rival.j, this.seed + 173))) {
          down = this.steepest(node, true);
        }
      }
    }
    node.down = down;
    return down;
  }

  /**
   * Number of grid nodes draining through this node, capped so lookups stay bounded.
   * ponytail: recursion depth is the longest upstream path (a few dozen nodes per basin); make it iterative if basins grow much larger.
   */
  private flow(node: RiverNode): number {
    if (node.flow !== undefined) return node.flow;
    let flow = 1;
    for (const [di, dj] of NEIGHBORS) {
      const upstream = this.node(node.i + di, node.j + dj);
      if (this.downstream(upstream) !== node) continue;
      flow += this.flow(upstream);
      if (flow >= RIVER_MAX_FLOW) break;
    }
    node.flow = Math.min(flow, RIVER_MAX_FLOW);
    return node.flow;
  }

  /** World-space grid keeps positions and density independent of chunk partitioning. */
  treesInArea(minX: number, minZ: number, size: number, spacing: number): Tree[] {
    const trees: Tree[] = [];
    for (let cz = Math.floor(minZ / spacing); cz <= Math.floor((minZ + size) / spacing); cz += 1) {
      for (let cx = Math.floor(minX / spacing); cx <= Math.floor((minX + size) / spacing); cx += 1) {
        const x = (cx + 0.15 + hash2(cx, cz, this.seed + 337) * 0.7) * spacing;
        const z = (cz + 0.15 + hash2(cx, cz, this.seed + 347) * 0.7) * spacing;
        if (x < minX || x >= minX + size || z < minZ || z >= minZ + size) continue;
        const sample = this.sample(x, z);
        // Clumps and gaps inside forests, so woodland is not an even carpet.
        const clumping = 0.5 + fbm(x / 120, z / 120, this.seed + 157, 2) * 1.2;
        if (sample.water || sample.rock > 0.72 || hash2(cx, cz, this.seed + 349) > 0.018 + sample.forest * clumping) continue;
        if (sample.bank < TREE_BANK_CLEARANCE) continue;
        const slope = Math.hypot(this.sample(x + 3, z).height - sample.height, this.sample(x, z + 3).height - sample.height) / 3;
        if (slope > MAX_TREE_SLOPE) continue;
        trees.push({
          x, y: sample.height, z,
          kind: Math.floor(hash2(cx, cz, this.seed + 353) * 3),
          scale: 0.72 + hash2(cx, cz, this.seed + 359) * 0.72,
          turn: hash2(cx, cz, this.seed + 361) * Math.PI * 2,
        });
      }
    }
    return trees;
  }

  thermalAtCell(cellX: number, cellZ: number): Thermal | null {
    const key = `${cellX},${cellZ}`;
    const cached = this.thermals.get(key);
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
    // Meadows, ridges, and modest sunlit slopes all qualify; steep rock is a bonus, not a magnet.
    const land = dry * 0.4 + open * 0.45 + sunFacing * 0.4 + slope * 0.12 + sample.rock * 0.12;
    return land * (0.2 + 0.8 * open);
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

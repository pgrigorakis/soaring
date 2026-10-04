import * as THREE from 'three';
import { ChunkBuffers } from './chunk-buffers';
import { bindMistHeightFog, type MistUniforms } from './cloud-sea';
import { InstancePool } from './instance-pool';
import { WaterPool } from './water-pool';
import { fbm, hash2, type LandscapeSample, type Tree, WorldModel } from './world';

/** Snow stays white; lighting supplies the blue shade. Steep faces remain granite. Snow follows temperature. */
export function snowCover(sample: LandscapeSample, slope: number, x: number, z: number, seed: number): number {
  const [start, full] = CLIMATE_LINES.snow;
  if (sample.water || slope >= Math.tan(40 * Math.PI / 180) || sample.temperature > start) return 0;
  if (sample.temperature <= full) return sample.biome.highlands;
  const altitude = (start - sample.temperature) / (start - full);
  const patch = fbm(x / 85, z / 85, seed + 389, 2) * 0.5 + 0.5;
  return sample.biome.highlands * THREE.MathUtils.smoothstep(altitude, patch * 0.65, patch * 0.65 + 0.35);
}

import { BIOME_ENTRIES, BIOME_KEYS, BIOME_PROFILES, CLIMATE_LINES, type BiomeKey } from './biome';
import type { GroundContext } from './biomes/types';

const beachGround = new THREE.Color(0xe3cd8b);
const scratch = new THREE.Color();
const extras = BIOME_ENTRIES.filter(([, profile]) => profile.groundExtras)
  .sort(([, a], [, b]) => a.extrasOrder! - b.extrasOrder!);
const fixedCrownKeys = BIOME_KEYS.filter((key) => BIOME_PROFILES[key].crowns.fixed !== undefined);
const waterTintKeys = BIOME_KEYS.filter((key) => BIOME_PROFILES[key].waterTint);
// Equal rock swatches share one overlay. This retains the old lowland sum and
// lerp rather than changing it into three successive, non-equivalent lerps.
const rockGroupMap = new Map<number, { color: THREE.Color; keys: BiomeKey[] }>();
for (const key of BIOME_KEYS) {
  const tint = BIOME_PROFILES[key].rockTint;
  if (tint === undefined) continue;
  if (!rockGroupMap.has(tint)) rockGroupMap.set(tint, { color: new THREE.Color(tint), keys: [] });
  rockGroupMap.get(tint)!.keys.push(key);
}
const rockGroups = [...rockGroupMap.values()];
// Chunk builds colour every vertex, so one context is reused rather than allocated per call.
const groundContext: GroundContext = { sample: undefined!, x: 0, z: 0, seed: 0, slope: 0, normalY: 1, fbm, snowCover, jitter: 0 };

/** All palette choices are world-sample based, including the shared vertices of adjacent chunks. */
export function terrainColor(sample: LandscapeSample, x: number, z: number, seed: number, target: THREE.Color, slope = 0, normalY = 1): THREE.Color {
  const { biome } = sample;
  const context = groundContext;
  context.sample = sample; context.x = x; context.z = z; context.seed = seed;
  context.slope = slope; context.normalY = normalY; context.jitter = hash2(Math.round(x), Math.round(z), seed + 310);
  const [firstKey, firstProfile] = BIOME_ENTRIES[0]!;
  firstProfile.ground(context, target).multiplyScalar(biome[firstKey]);
  for (let index = 1; index < BIOME_ENTRIES.length; index += 1) {
    const [key, profile] = BIOME_ENTRIES[index]!;
    profile.ground(context, scratch).multiplyScalar(biome[key]);
    target.add(scratch);
  }
  for (const { color, keys } of rockGroups) {
    let weight = 0;
    for (const key of keys) weight += biome[key];
    target.lerp(color, sample.rock * weight);
  }
  for (const [key, profile] of extras) profile.groundExtras!(context, target, biome[key]);
  // FWM's height-relative beach fade applies to every biome, not only Lakeland.
  if (!sample.water) target.lerp(beachGround, 1 - THREE.MathUtils.smoothstep(sample.height, 1.5, 7.5));
  if (sample.water) target.set(0x2f6e6a);
  return target;
}

function treeColor(tree: Tree, target: THREE.Color): THREE.Color {
  const remainder = fixedCrownKeys.reduce((weight, key) => weight - tree.biome[key], 1);
  target.set(tree.tint).multiplyScalar(remainder);
  for (const key of fixedCrownKeys) {
    target.add(scratch.set(BIOME_PROFILES[key].crowns.fixed!).multiplyScalar(tree.biome[key]));
  }
  return target;
}

export const CHUNK_SIZE = 360;
export const MIN_VISIBILITY = 720;
export const MAX_VISIBILITY = 5000;
export const DEFAULT_VISIBILITY = 5000;
const NEAR_RADIUS = 3; // chunks (fine grid): individual trees, rocks, full-density mesh
// Beyond this distance, forest reads as terrain color only - no per-tree geometry.
const TREE_CUTOFF = 3000;
// Mesh LOD switches to a coarser, larger-tile grid here. A multiple of both grid sizes so the
// two grids' tile edges always coincide - the coarse grid never straddles a fine tile.
const FAR_CHUNK_SIZE = CHUNK_SIZE * 4;
const FAR_START = FAR_CHUNK_SIZE * 3;
const DETAIL = { segments: 40, rocks: 10 };
const MID = { segments: 20, rocks: 0 };
const FAR = { segments: 16, rocks: 0 };
const TREE_SPACING = 29;
// Shared pool capacities fit the densest Woodland ring measured by scripts/audit-tree-pools.mjs,
// including a one-chunk move before rebuilds finish, with headroom. A full pool grows rather than drop trees.
const POOL_CAPACITY = { midTrees: 40_000, nearTrunks: 12_000, cones: 7_500, broadleaf: 7_500, birch: 1_500 };
// Water blocks of 16 quads. The capacity grows if a lake-heavy ring needs more.
const WATER_CAPACITY = 4096;
// Instance data stays relative to an anchor near the stream, so long flights keep float32 precision.
const POOL_ANCHOR_DISTANCE = 8000;

type Tier = 'near' | 'mid' | 'far';
type TreeMode = 'near' | 'far' | 'none';
type Chunk = { group: THREE.Group; tier: Tier; descriptor: string; dispose: () => void };
type Pending = { x: number; z: number; key: string; chunkSize: number; tier: Tier; trees: TreeMode; descriptor: string };

export class TerrainStream {
  private readonly scene: THREE.Object3D;
  private readonly world: WorldModel;
  private readonly chunks = new Map<string, Chunk>();
  private reach: number;
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private rawX = 0;
  private rawZ = 0;
  private pending: Pending[] = [];
  private buildTotalMs = 0;
  private buildCount = 0;
  private buildMaxMs = 0;
  private maxSliceMs = 0;
  private maxUpdateMs = 0;
  private allocated = 0;
  private reused = 0;
  private active: { tile: Pending; job: Generator<void, Chunk>; cpuMs: number } | null = null;
  private readonly free: Record<Tier, ChunkBuffers[]> = { near: [], mid: [], far: [] };
  private readonly samples: LandscapeSample[] = [];
  private readonly wet = new Uint8Array(41 * 41);
  private readonly levels = new Float64Array(41 * 41);
  private readonly waterDepth = new Float64Array(41 * 41);

  get buildTiming() {
    return { chunks: this.buildCount, meanMs: this.buildTotalMs / Math.max(1, this.buildCount), maxMs: this.buildMaxMs,
      maxSliceMs: this.maxSliceMs, maxUpdateMs: this.maxUpdateMs, allocated: this.allocated, reused: this.reused };
  }

  private cancelBuild(): void {
    this.active?.job.return(undefined as never);
    this.active = null;
    this.samples.length = 0;
  }

  private release(tier: Tier, buffers: ChunkBuffers): void {
    // Two fine-grid rings fit in 64 entries. Bound retained memory after teleports/clear.
    if (this.free[tier].length < 64) this.free[tier].push(buffers);
    else buffers.dispose();
  }

  private readonly terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  // Fades the shadow to fully lit near the fixed shadow camera's edge, in place of a hard cutoff.
  private readonly shadowFadeRange = { value: new THREE.Vector2() };
  private readonly waterLightDirection = { value: new THREE.Vector3(0, 1, 0) };
  private readonly waterGlintColor = { value: new THREE.Color(0xfff1c2) };
  private readonly waterSparkle = { value: 0 };
  private readonly waterTime = { value: 0 };
  private readonly waterPatternOffset = { value: new THREE.Vector2() };
  private readonly waterDeepColor = { value: new THREE.Color(0x2b6c73) };
  private readonly waterShallowColor = { value: new THREE.Color(0x78b4a3) };
  private readonly waterMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.16,
    metalness: 0.05,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 });
  private readonly foliageMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
  ];
  private readonly rockMaterial = new THREE.MeshStandardMaterial({ color: 0x857e72, roughness: 1, flatShading: true });
  private readonly trunkGeometry = new THREE.CylinderGeometry(0.8, 1.35, 9, 5);
  private readonly crownGeometries = [
    new THREE.ConeGeometry(5.5, 12, 7), // layered conifer
    new THREE.IcosahedronGeometry(6.8, 1), // spreading deciduous crown
    new THREE.IcosahedronGeometry(3.7, 1), // tall, narrow tree
  ];
  private readonly rockGeometry = new THREE.DodecahedronGeometry(4.5, 0);
  private readonly torGeometry = new THREE.BoxGeometry(6, 3.2, 5);
  private readonly hedgeGeometry = new THREE.DodecahedronGeometry(1, 0);
  private readonly hedgeMaterial = new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: 1, flatShading: true });
  // Distant trees keep the near placement, trunks, and colors with a simpler crown.
  private readonly farCrownGeometry = new THREE.IcosahedronGeometry(5.4, 0);
  private readonly farFoliageMaterial = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
  // One draw call per tree shape for the whole ring, not one per tile. Mid-tier trees start beyond
  // the near tiles, outside the shadow camera's 600 m range, so they skip the shadow pass.
  private readonly midTrunkPool: InstancePool;
  private readonly midCrownPool: InstancePool;
  private readonly nearTrunkPool: InstancePool;
  // Conifers draw a lower and an upper cone from the same pool.
  private readonly crownPools: InstancePool[];
  private readonly waterPool: WaterPool;

  // Reach is the horizontal distance from the camera's tile that must be loaded.
  constructor(scene: THREE.Object3D, world: WorldModel, reach = MIN_VISIBILITY) {
    this.scene = scene;
    this.world = world;
    this.reach = reach;
    this.midTrunkPool = new InstancePool(scene, 'mid tree trunks', POOL_CAPACITY.midTrees, this.trunkGeometry, this.trunkMaterial, false, false);
    this.midCrownPool = new InstancePool(scene, 'mid tree crowns', POOL_CAPACITY.midTrees, this.farCrownGeometry, this.farFoliageMaterial, true, false);
    this.nearTrunkPool = new InstancePool(scene, 'near tree trunks', POOL_CAPACITY.nearTrunks, this.trunkGeometry, this.trunkMaterial, false, true);
    this.crownPools = (['cones', 'broadleaf', 'birch'] as const).map((kind, index) =>
      new InstancePool(scene, `near ${kind}`, POOL_CAPACITY[kind], this.crownGeometries[index]!, this.foliageMaterials[index]!, true, true));
    this.waterPool = new WaterPool(scene, WATER_CAPACITY, this.waterMaterial);
    // Water lies on the ground under every other transparent object, so it blends first.
    this.waterPool.mesh.renderOrder = -1;
    this.terrainMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.shadowFadeRange = this.shadowFadeRange;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <shadowmap_pars_fragment>',
        `${THREE.ShaderChunk.shadowmap_pars_fragment.replace('float getShadow(', 'float getShadowUnfaded(')}
#ifdef USE_SHADOWMAP
uniform vec2 shadowFadeRange;
float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  float raw = getShadowUnfaded( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord );
  float fade = 1.0 - smoothstep( shadowFadeRange.x, shadowFadeRange.y, length( vViewPosition ) );
  return mix( 1.0, raw, fade );
}
#endif`,
      );
    };
    // Integer cell hash plus the floating-origin offset. A float hash of world XZ repeats on long flights.
    // The offset keeps ripple phase continuous when the render origin rebases.
    this.waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.waterLightDirection = this.waterLightDirection;
      shader.uniforms.waterGlintColor = this.waterGlintColor;
      shader.uniforms.waterSparkle = this.waterSparkle;
      shader.uniforms.waterTime = this.waterTime;
      shader.uniforms.waterPatternOffset = this.waterPatternOffset;
      shader.uniforms.waterDeepColor = this.waterDeepColor;
      shader.uniforms.waterShallowColor = this.waterShallowColor;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float waterDepth;
varying vec3 vWaterWorldPosition;
varying float vWaterDepth;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vWaterWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vWaterDepth = waterDepth;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 waterLightDirection;
uniform vec3 waterGlintColor;
uniform float waterSparkle;
uniform float waterTime;
uniform vec2 waterPatternOffset;
uniform vec3 waterDeepColor;
uniform vec3 waterShallowColor;
varying vec3 vWaterWorldPosition;
varying float vWaterDepth;

float waterHash(vec2 cell) {
  uvec2 bits = uvec2(ivec2(cell)) * uvec2(1597334673u, 3812015801u);
  uint hash = (bits.x ^ bits.y) * 1597334673u;
  hash ^= hash >> 16u;
  return float(hash) * (1.0 / 4294967295.0);
}

float waterValueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 curve = local * local * (3.0 - 2.0 * local);
  float lower = mix(waterHash(cell), waterHash(cell + vec2(1.0, 0.0)), curve.x);
  float upper = mix(waterHash(cell + vec2(0.0, 1.0)), waterHash(cell + vec2(1.0, 1.0)), curve.x);
  return mix(lower, upper, curve.y);
}

float waterRippleHeight(vec2 worldXZ) {
  mat2 rotateA = mat2(0.83, -0.55, 0.55, 0.83);
  mat2 rotateB = mat2(0.47, 0.88, -0.88, 0.47);
  float warpNoise = waterValueNoise(rotateA * worldXZ * 0.035 + vec2(waterTime * 0.015, -waterTime * 0.01));
  vec2 warped = worldXZ + vec2(warpNoise - 0.5, 0.5 - warpNoise) * 6.0;
  vec2 low = rotateA * warped * 0.10 + vec2(waterTime * 0.12, -waterTime * 0.08);
  vec2 mid = rotateB * warped * 0.29 + vec2(31.7, 7.9) + vec2(-waterTime * 0.15, waterTime * 0.10);
  return waterValueNoise(low) * 1.8 + waterValueNoise(mid) * 0.85;
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if ( vWaterDepth <= 0.0 ) discard;
vec3 biomeWaterColor = diffuseColor.rgb;
float shallowWater = 1.0 - smoothstep( 0.7, 3.2, vWaterDepth );
vec3 depthWaterColor = mix( waterDeepColor, waterShallowColor, shallowWater );
diffuseColor.rgb = mix( depthWaterColor, biomeWaterColor, 0.35 );`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
vec2 waterWorldXZ = vWaterWorldPosition.xz;
float rippleHeight = waterRippleHeight( waterWorldXZ + waterPatternOffset );
vec2 positionDx = dFdx( waterWorldXZ );
vec2 positionDy = dFdy( waterWorldXZ );
float heightDx = dFdx( rippleHeight );
float heightDy = dFdy( rippleHeight );
float determinant = positionDx.x * positionDy.y - positionDy.x * positionDx.y;
vec2 rippleSlope = vec2( 0.0 );
if ( abs( determinant ) > 0.00001 ) {
  rippleSlope = vec2(
    heightDx * positionDy.y - heightDy * positionDx.y,
    positionDx.x * heightDy - positionDy.x * heightDx
  ) / determinant;
}
float pixelFootprint = max( length( positionDx ), length( positionDy ) );
float rippleFade = 1.0 - smoothstep( 1.25, 3.8, pixelFootprint );
rippleSlope = clamp( rippleSlope, vec2( -0.9 ), vec2( 0.9 ) ) * rippleFade * 0.55;
vec3 waterBaseWorldNormal = normalize( transpose( mat3( viewMatrix ) ) * normal );
vec3 waterWorldNormal = normalize( waterBaseWorldNormal + vec3( -rippleSlope.x, 0.0, -rippleSlope.y ) );
normal = normalize( mat3( viewMatrix ) * waterWorldNormal );`,
        )
        .replace(
          'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
          `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
vec3 waterViewDirection = normalize( cameraPosition - vWaterWorldPosition );
vec3 waterHalfVector = normalize( waterViewDirection + normalize( waterLightDirection ) );
float waterGlint = pow( max( dot( waterWorldNormal, waterHalfVector ), 0.0 ), 100.0 );
float waterShimmer = 1.0 + 0.12 * sin( waterTime * 0.55 );
outgoingLight += waterGlintColor * waterGlint * waterSparkle * waterShimmer * 4.6;`,
        );
    };
  }

  // Distance (from the camera) at which the fixed-range shadow starts, and finishes, fading to fully lit.
  setShadowFadeRange(inner: number, outer: number): void {
    this.shadowFadeRange.value.set(inner, outer);
  }

  setWaterLighting(direction: THREE.Vector3, sunHeight: number, moonHeight: number, sunDominant: boolean, delta: number, renderOrigin: THREE.Vector3): void {
    this.waterLightDirection.value.copy(direction);
    this.waterPatternOffset.value.set(renderOrigin.x, renderOrigin.z);
    if (sunDominant) {
      const sunUp = THREE.MathUtils.smoothstep(sunHeight, 0, 0.1);
      const goldenHour = THREE.MathUtils.smoothstep(sunHeight, 0.015, 0.1)
        * (1 - THREE.MathUtils.smoothstep(sunHeight, 0.2, 0.5));
      this.waterGlintColor.value.set(0xfff1c2);
      this.waterSparkle.value = sunUp * (0.28 + goldenHour * 0.72);
    } else {
      this.waterGlintColor.value.set(0xdde7f0);
      this.waterSparkle.value = THREE.MathUtils.smoothstep(moonHeight, 0, 0.35) * 0.16;
    }
    this.waterTime.value += Math.max(0, delta);
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  // Loaded chunk counts per level of detail, for diagnostics.
  get tierCounts(): { near: number; mid: number; far: number } {
    const counts = { near: 0, mid: 0, far: 0 };
    for (const chunk of this.chunks.values()) counts[chunk.tier] += 1;
    return counts;
  }

  setReach(reach: number): void {
    if (reach === this.reach) return;
    this.reach = reach;
    if (Number.isFinite(this.centerX)) this.recenter(this.centerX, this.centerZ);
  }

  // The nearest missing tile limits haze, including while a new ring streams in. Tiles outside
  // the loaded disk are at least `reach` away from any point of the camera's tile.
  // Camera coordinates (not eagle coordinates) are used so orbit and distance cannot reveal an edge.
  coveredDistance(x: number, z: number): number {
    let distance = Infinity;
    for (const tile of this.pending) {
      if (this.chunks.has(tile.key)) continue; // A coarse tile remains visible while it is upgraded.
      const minX = tile.x * tile.chunkSize;
      const minZ = tile.z * tile.chunkSize;
      distance = Math.min(distance, Math.hypot(
        Math.max(minX - x, 0, x - minX - tile.chunkSize),
        Math.max(minZ - z, 0, z - minZ - tile.chunkSize),
      ));
    }
    return Math.max(0, Math.min(this.reach, distance - 12));
  }

  get pendingCount(): number { return this.pending.length; }

  update(x: number, z: number, buildBudgetMs = 4): number {
    const start = performance.now();
    this.rawX = x;
    this.rawZ = z;
    const centerX = Math.floor(x / CHUNK_SIZE);
    const centerZ = Math.floor(z / CHUNK_SIZE);
    if (centerX !== this.centerX || centerZ !== this.centerZ) this.recenter(centerX, centerZ);
    let built = 0;
    while (this.pending.length > 0 && performance.now() - start < buildBudgetMs) {
      // Finish already-started work if recenter still needs it. New jobs remain nearest first.
      const next = this.active?.tile ?? this.pending[0]!;
      this.active ??= { tile: next, job: this.createChunk(next), cpuMs: 0 };
      const sliceStart = performance.now();
      const result = this.active.job.next();
      const elapsed = performance.now() - sliceStart;
      this.active.cpuMs += elapsed;
      this.maxSliceMs = Math.max(this.maxSliceMs, elapsed);
      if (!result.done) continue;
      this.buildTotalMs += this.active.cpuMs;
      this.buildCount += 1;
      this.buildMaxMs = Math.max(this.buildMaxMs, this.active.cpuMs);
      this.active = null;
      this.samples.length = 0;
      this.pending.splice(this.pending.findIndex((tile) => tile.key === next.key), 1);
      const old = this.chunks.get(next.key);
      if (old) { this.scene.remove(old.group); old.dispose(); }
      this.scene.add(result.value.group);
      this.chunks.set(next.key, result.value);
      built += 1;
    }
    this.maxUpdateMs = Math.max(this.maxUpdateMs, performance.now() - start);
    return built;
  }

  private recenter(centerX: number, centerZ: number): void {
    this.centerX = centerX;
    this.centerZ = centerZ;
    const anchor = this.midTrunkPool.mesh.position;
    if (Math.hypot(centerX * CHUNK_SIZE - anchor.x, centerZ * CHUNK_SIZE - anchor.z) > POOL_ANCHOR_DISTANCE) {
      for (const pool of this.pools) pool.reanchor(centerX * CHUNK_SIZE, centerZ * CHUNK_SIZE);
    }
    const needed = new Set<string>();
    this.pending = [];

    // Fine grid (near + mid tiers): full density near the eagle, thinning to mid density,
    // covering the ground out to where the coarse far grid takes over.
    const fineReach = Math.min(this.reach, FAR_START);
    const fineRadius = Math.ceil(fineReach / CHUNK_SIZE);
    for (let dz = -fineRadius; dz <= fineRadius; dz += 1) {
      for (let dx = -fineRadius; dx <= fineRadius; dx += 1) {
        const gap = Math.hypot(Math.max(Math.abs(dx) - 1, 0), Math.max(Math.abs(dz) - 1, 0)) * CHUNK_SIZE;
        if (gap >= fineReach) continue;
        const key = `n:${centerX + dx},${centerZ + dz}`;
        needed.add(key);
        const tier: Tier = gap <= NEAR_RADIUS * CHUNK_SIZE ? 'near' : 'mid';
        const trees: TreeMode = tier === 'near' ? 'near' : gap < TREE_CUTOFF ? 'far' : 'none';
        const descriptor = `${tier}:${trees}`;
        if (this.chunks.get(key)?.descriptor !== descriptor) {
          this.pending.push({ x: centerX + dx, z: centerZ + dz, key, chunkSize: CHUNK_SIZE, tier, trees, descriptor });
        }
      }
    }

    // Coarse far grid: lower mesh resolution, no trees, tiles are 4x the fine chunk size so
    // their edges always land on fine-grid tile boundaries.
    if (this.reach > FAR_START) {
      const farCenterX = Math.floor(this.rawX / FAR_CHUNK_SIZE);
      const farCenterZ = Math.floor(this.rawZ / FAR_CHUNK_SIZE);
      const farRadius = Math.ceil(this.reach / FAR_CHUNK_SIZE);
      for (let dz = -farRadius; dz <= farRadius; dz += 1) {
        for (let dx = -farRadius; dx <= farRadius; dx += 1) {
          const tileMinX = (farCenterX + dx) * FAR_CHUNK_SIZE;
          const tileMinZ = (farCenterZ + dz) * FAR_CHUNK_SIZE;
          const nearestGap = Math.hypot(
            Math.max(tileMinX - this.rawX, 0, this.rawX - tileMinX - FAR_CHUNK_SIZE),
            Math.max(tileMinZ - this.rawZ, 0, this.rawZ - tileMinZ - FAR_CHUNK_SIZE),
          );
          if (nearestGap >= this.reach) continue;
          // Skip only when the tile's farthest point is still inside the fine grid's disk -
          // i.e. the whole tile is already covered. A tile straddling the boundary is kept,
          // even though that means a thin ring of overlap with the fine grid, never a gap.
          const farthestX = Math.max(Math.abs(tileMinX - this.rawX), Math.abs(tileMinX + FAR_CHUNK_SIZE - this.rawX));
          const farthestZ = Math.max(Math.abs(tileMinZ - this.rawZ), Math.abs(tileMinZ + FAR_CHUNK_SIZE - this.rawZ));
          const farthestGap = Math.hypot(farthestX, farthestZ);
          if (farthestGap <= FAR_START) continue;
          const key = `f:${farCenterX + dx},${farCenterZ + dz}`;
          needed.add(key);
          const descriptor = 'far:none';
          if (this.chunks.get(key)?.descriptor !== descriptor) {
            this.pending.push({ x: farCenterX + dx, z: farCenterZ + dz, key, chunkSize: FAR_CHUNK_SIZE, tier: 'far', trees: 'none', descriptor });
          }
        }
      }
    }

    this.pending.sort((a, b) =>
      Math.hypot(a.x * a.chunkSize - centerX * CHUNK_SIZE, a.z * a.chunkSize - centerZ * CHUNK_SIZE)
      - Math.hypot(b.x * b.chunkSize - centerX * CHUNK_SIZE, b.z * b.chunkSize - centerZ * CHUNK_SIZE));

    const active = this.active;
    if (active && !this.pending.some((tile) => tile.key === active.tile.key
      && tile.descriptor === active.tile.descriptor)) this.cancelBuild();

    for (const [key, chunk] of this.chunks) {
      if (needed.has(key)) continue;
      this.scene.remove(chunk.group);
      chunk.dispose();
      this.chunks.delete(key);
    }
  }

  private get pools(): (InstancePool | WaterPool)[] {
    return [this.midTrunkPool, this.midCrownPool, this.nearTrunkPool, ...this.crownPools, this.waterPool];
  }

  /** Live and total slots per shared pool, for diagnostics and tests. */
  get poolUsage(): Record<string, { used: number; capacity: number; grown: number }> {
    return Object.fromEntries(this.pools.map((pool) => [pool.mesh.name, { used: pool.used, capacity: pool.capacity, grown: pool.grown }]));
  }

  clear(): void {
    this.cancelBuild();
    for (const chunk of this.chunks.values()) {
      this.scene.remove(chunk.group);
      chunk.dispose();
    }
    this.chunks.clear();
    this.pending = [];
    this.centerX = Number.NaN;
    this.centerZ = Number.NaN;
  }

  bindMist(uniforms: MistUniforms): void {
    // Terrain and water carry the valley veil. Trees stay unfogged so a morning sheet does not tax every crown.
    for (const material of [this.terrainMaterial, this.waterMaterial]) bindMistHeightFog(material, uniforms);
  }

  dispose(): void {
    this.clear();
    for (const buffers of Object.values(this.free).flat()) buffers.dispose();
    for (const pool of Object.values(this.free)) pool.length = 0;
    for (const pool of this.pools) pool.dispose();
    this.terrainMaterial.dispose();
    this.waterMaterial.dispose();
    this.trunkMaterial.dispose();
    this.foliageMaterials.forEach((material) => material.dispose());
    this.rockMaterial.dispose();
    this.trunkGeometry.dispose();
    this.crownGeometries.forEach((geometry) => geometry.dispose());
    this.rockGeometry.dispose();
    this.torGeometry.dispose();
    this.hedgeGeometry.dispose();
    this.hedgeMaterial.dispose();
    this.farCrownGeometry.dispose();
    this.farFoliageMaterial.dispose();
  }

  private *createChunk({ x: chunkX, z: chunkZ, chunkSize, tier, trees: treeMode }: Pending): Generator<void, Chunk> {
    const detailed = tier === 'near';
    const group = new THREE.Group();
    group.name = chunkSize === CHUNK_SIZE ? `land ${chunkX},${chunkZ}` : `land far ${chunkX},${chunkZ}`;
    const config = tier === 'near' ? DETAIL : tier === 'mid' ? MID : FAR;
    const segments = config.segments;
    const step = chunkSize / segments;
    const originX = chunkX * chunkSize;
    const originZ = chunkZ * chunkSize;
    group.position.set(originX, 0, originZ);
    let buffers = this.free[tier].pop();
    if (buffers) this.reused += 1;
    else { buffers = new ChunkBuffers(segments, segments, !detailed); this.allocated += 1; }
    const owned = buffers;
    let complete = false;
    const pooled: InstancePool[] = [];
    const waterBlocks: number[] = [];
    const slots: number[] = [];
    const release = () => {
      group.traverse((object) => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      slots.forEach((slot, index) => pooled[index]!.remove(slot));
      slots.length = 0;
      this.waterPool.remove(waterBlocks);
      waterBlocks.length = 0;
      this.release(tier, owned);
    };
    try {
      const geometry = buffers.geometry;
      const { positions, normals, colors, indices } = buffers;
      let vertex = 0;
      let indexCount = 0;
      const color = new THREE.Color();
      const normal = new THREE.Vector3();
      const row = segments + 3;
      const samples = this.samples;
      for (let zIndex = -1; zIndex <= segments + 1; zIndex += 1) {
        for (let xIndex = -1; xIndex <= segments + 1; xIndex += 1) {
          samples.push(this.world.sample(originX + xIndex * step, originZ + zIndex * step));
          if ((xIndex + 1) % 8 === 0) yield;
        }
      }
      const sampleAt = (xIndex: number, zIndex: number) => samples[(zIndex + 1) * row + xIndex + 1]!;
      const heightAt = (xIndex: number, zIndex: number) => sampleAt(xIndex, zIndex).height;

      const hedgeBlocks: { x: number; y: number; z: number; turn: number; weight: number }[] = [];

      for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
        for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
          const x = originX + xIndex * step;
          const z = originZ + zIndex * step;
          const sample = sampleAt(xIndex, zIndex);
          const base = vertex++ * 3;
          positions[base] = x - originX; positions[base + 1] = sample.height; positions[base + 2] = z - originZ;
          normal.set(
            heightAt(xIndex - 1, zIndex) - heightAt(xIndex + 1, zIndex),
            step * 2,
            heightAt(xIndex, zIndex - 1) - heightAt(xIndex, zIndex + 1),
          ).normalize();
          normals[base] = normal.x; normals[base + 1] = normal.y; normals[base + 2] = normal.z;
          const slope = Math.hypot(normal.x, normal.z) / normal.y;
          const edge = sample.fieldEdge;
          if (detailed && edge && sample.biome.hills > 0 && !sample.water && sample.bank > 20 && slope < 0.45
            && edge.x >= originX && edge.x < originX + chunkSize && edge.z >= originZ && edge.z < originZ + chunkSize) {
            hedgeBlocks.push({
              x: edge.x - originX, y: sample.height + 1.6 * sample.biome.hills,
              z: edge.z - originZ, turn: edge.turn, weight: sample.biome.hills
            });
          }
          terrainColor(sample, x, z, this.world.seed, color, slope, normal.y);
          const hueJitter = (hash2(Math.round(x), Math.round(z), this.world.seed + 311) - 0.5) * 0.03;
          const saturationJitter = (hash2(Math.round(x), Math.round(z), this.world.seed + 312) - 0.5) * 0.12;
          const lightnessJitter = (hash2(Math.round(x), Math.round(z), this.world.seed + 313) - 0.5) * 0.06;
          color.offsetHSL(hueJitter, saturationJitter, lightnessJitter);
          colors[base] = color.r; colors[base + 1] = color.g; colors[base + 2] = color.b;
          if (xIndex % 8 === 0) yield;
        }
      }
      for (let zIndex = 0; zIndex < segments; zIndex += 1) {
        for (let xIndex = 0; xIndex < segments; xIndex += 1) {
          const a = zIndex * (segments + 1) + xIndex;
          const b = a + 1;
          const c = a + segments + 1;
          const d = c + 1;
          indices[indexCount++] = a; indices[indexCount++] = c; indices[indexCount++] = b;
          indices[indexCount++] = b; indices[indexCount++] = c; indices[indexCount++] = d;
        }
      }
      if (!detailed) {
        // High-detail neighbors have more edge vertices. A downward skirt hides
        // interpolation cracks without multiplying the far-field mesh density.
        const edge = (vertices: number[], outward: boolean) => {
          for (let i = 0; i < vertices.length; i += 1) {
            const top = vertices[i]!;
            const base = top * 3;
            const bottom = vertex++;
            const dst = bottom * 3;
            positions[dst] = positions[base]!; positions[dst + 1] = positions[base + 1]! - 140; positions[dst + 2] = positions[base + 2]!;
            for (let j = 0; j < 3; j += 1) { normals[dst + j] = normals[base + j]!; colors[dst + j] = colors[base + j]!; }
            if (i > 0) {
              const prev = vertices[i - 1]!;
              const prevBottom = bottom - 1;
              indices[indexCount++] = prev;
              indices[indexCount++] = outward ? top : prevBottom;
              indices[indexCount++] = outward ? prevBottom : top;
              indices[indexCount++] = top;
              indices[indexCount++] = outward ? bottom : prevBottom;
              indices[indexCount++] = outward ? prevBottom : bottom;
            }
          }
        };
        edge(Array.from({ length: segments + 1 }, (_, i) => i), true);
        edge(Array.from({ length: segments + 1 }, (_, i) => segments * (segments + 1) + i), false);
        edge(Array.from({ length: segments + 1 }, (_, i) => i * (segments + 1)), false);
        edge(Array.from({ length: segments + 1 }, (_, i) => i * (segments + 1) + segments), true);
      }
      for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
      geometry.index!.needsUpdate = true;
      geometry.computeBoundingSphere();
      yield;
      const terrain = new THREE.Mesh(geometry, this.terrainMaterial);
      terrain.receiveShadow = true;
      terrain.castShadow = true;
      group.add(terrain);

      // Water uses the actual terrain vertices and diagonal. Signed depth then
      // interpolates on the same triangles; the shader clips at the zero crossing.
      // Sea level is identical across tiers, so there is no local-level water seam.
      const { wet, levels, waterDepth } = this;
      let waterVertex = 0;
      for (let iz = 0; iz <= segments; iz++) {
        for (let ix = 0; ix <= segments; ix++) {
          const sample = sampleAt(ix, iz);
          wet[waterVertex] = Number(sample.water);
          levels[waterVertex] = sample.surface;
          waterDepth[waterVertex++] = sample.surface - sample.height;
          if (ix % 8 === 0) yield;
        }
      }
      const waterGeometry = yield* this.createWaterGeometry(originX, originZ, chunkSize, segments, wet, levels, waterDepth, buffers);
      // The shared water pool draws a copy; the tile keeps its built water as a hidden source mesh.
      const waterSource = waterGeometry ? new THREE.Mesh(waterGeometry, this.waterMaterial) : null;
      if (waterSource) { waterSource.visible = false; group.add(waterSource); }

      const trees = treeMode === 'none' ? [] : yield* this.world.buildTreesInArea(originX, originZ, CHUNK_SIZE, TREE_SPACING);
      const rocks = this.createRocks(chunkX, chunkZ, config.rocks, originX, originZ);
      if (rocks) group.add(rocks);
      const tors = detailed ? this.createTors(chunkX, chunkZ) : null;
      if (tors) group.add(tors);
      const hedges = hedgeBlocks.length ? new THREE.InstancedMesh(this.hedgeGeometry, this.hedgeMaterial, hedgeBlocks.length) : null;
      if (hedges) {
        hedges.name = 'hedgerows';
        const dummy = new THREE.Object3D();
        hedgeBlocks.forEach((block, index) => {
          dummy.position.set(block.x, block.y, block.z);
          dummy.rotation.set(0, block.turn, 0);
          dummy.scale.set(1.3 * block.weight, 1.8 * block.weight, 7);
          dummy.updateMatrix();
          hedges.setMatrixAt(index, dummy.matrix);
        });
        hedges.instanceMatrix.needsUpdate = true;
        hedges.castShadow = true;
        hedges.receiveShadow = true;
        group.add(hedges);
      }

      // Pool slots are claimed in the build's last slice, so trees appear together with their tile.
      if (treeMode === 'near') this.placeNearTrees(trees, pooled, slots);
      else this.placeFarTrees(trees, pooled, slots);
      if (waterGeometry) waterBlocks.push(...this.waterPool.add(waterGeometry, originX, originZ));
      complete = true;
      return { group, tier, descriptor: `${tier}:${treeMode}`, dispose: release };
    } finally {
      this.samples.length = 0;
      if (!complete) release();
    }
  }

  private *createWaterGeometry(originX: number, originZ: number, chunkSize: number, segments: number, water: Uint8Array, surface: Float64Array, waterDepth: Float64Array, buffers: ChunkBuffers): Generator<void, THREE.BufferGeometry | null> {
    const step = chunkSize / segments;
    const positions = buffers.waterPositions;
    const depths = buffers.depths;
    const colors = buffers.waterColors;
    const indices = buffers.waterIndices;
    let vertex = 0;
    let indexCount = 0;
    indices.fill(0);
    const waterColor = new THREE.Color();
    for (let iz = 0; iz < segments; iz += 1) {
      for (let ix = 0; ix < segments; ix += 1) {
        const a = iz * (segments + 1) + ix;
        const corners = [a, a + 1, a + segments + 1, a + segments + 2];
        const localX = ix * step;
        const localZ = iz * step;
        const worldX = originX + localX;
        const worldZ = originZ + localZ;
        if (!corners.some((corner) => water[corner])) continue;
        const [y0, y1, y2, y3] = corners.map((corner) => surface[corner]!);
        const base = vertex;
        const offset = base * 3;
        positions[offset] = localX; positions[offset + 1] = y0!; positions[offset + 2] = localZ;
        positions[offset + 3] = localX + step; positions[offset + 4] = y1!; positions[offset + 5] = localZ;
        positions[offset + 6] = localX; positions[offset + 7] = y2!; positions[offset + 8] = localZ + step;
        positions[offset + 9] = localX + step; positions[offset + 10] = y3!; positions[offset + 11] = localZ + step;
        for (let corner = 0; corner < 4; corner += 1) {
          const dx = corner % 2 * step;
          const dz = Math.floor(corner / 2) * step;
          depths[vertex] = waterDepth[corners[corner]!]!;
          const sample = this.world.sample(worldX + dx!, worldZ + dz!);
          waterColor.set(0x2a8fa8);
          for (const key of waterTintKeys) {
            BIOME_PROFILES[key].waterTint!(sample, scratch);
            waterColor.lerp(scratch, sample.biome[key]);
          }
          colors[vertex * 3] = waterColor.r; colors[vertex * 3 + 1] = waterColor.g; colors[vertex * 3 + 2] = waterColor.b;
          vertex += 1;
        }
        indices[indexCount++] = base; indices[indexCount++] = base + 2; indices[indexCount++] = base + 1;
        indices[indexCount++] = base + 1; indices[indexCount++] = base + 2; indices[indexCount++] = base + 3;
        yield;
      }
    }
    if (vertex === 0) return null;
    const geometry = buffers.water;
    geometry.setDrawRange(0, indexCount);
    for (const attribute of Object.values(geometry.attributes)) {
      // Three.js stores count as mutable metadata; the backing GPU capacity stays fixed.
      Object.defineProperty(attribute, 'count', { value: vertex });
      attribute.needsUpdate = true;
    }
    geometry.index!.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    yield;
    return geometry;
  }

  private placeNearTrees(trees: Tree[], pooled: InstancePool[], slots: number[]): void {
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const place = (pool: InstancePool, color?: THREE.Color) => {
      dummy.updateMatrix();
      slots.push(pool.add(dummy.matrix, color));
      pooled.push(pool);
    };
    for (const tree of trees) {
      const kind = tree.kind;
      dummy.position.set(tree.x, tree.y + 4.5 * tree.scale, tree.z);
      dummy.rotation.set(0, tree.turn, 0);
      dummy.scale.setScalar(tree.scale);
      place(this.nearTrunkPool);
      treeColor(tree, tint);
      dummy.position.y = tree.y + (kind === 2 ? 18 : 14) * tree.scale;
      dummy.scale.set(tree.scale, tree.scale * (kind === 0 ? 1.4 : kind === 1 ? 0.83 : 2.6), tree.scale);
      place(this.crownPools[kind]!, tint);
      if (kind === 0) {
        dummy.position.y = tree.y + 22 * tree.scale;
        dummy.scale.setScalar(tree.scale * 0.85);
        place(this.crownPools[0]!, tint);
      }
    }
  }

  private placeFarTrees(trees: Tree[], pooled: InstancePool[], slots: number[]): void {
    const tint = new THREE.Color();
    const dummy = new THREE.Object3D();
    for (const tree of trees) {
      dummy.position.set(tree.x, tree.y + 4.5 * tree.scale, tree.z);
      dummy.rotation.set(0, tree.turn, 0);
      dummy.scale.setScalar(tree.scale);
      dummy.updateMatrix();
      slots.push(this.midTrunkPool.add(dummy.matrix));
      pooled.push(this.midTrunkPool);
      dummy.position.y = tree.y + (tree.kind === 2 ? 18 : 14) * tree.scale;
      dummy.scale.set(tree.scale * (tree.kind === 2 ? 0.68 : 1.2), tree.scale * (tree.kind === 0 ? 1.55 : tree.kind === 1 ? 1.05 : 1.8), tree.scale * (tree.kind === 2 ? 0.68 : 1.2));
      dummy.updateMatrix();
      slots.push(this.midCrownPool.add(dummy.matrix, treeColor(tree, tint)));
      pooled.push(this.midCrownPool);
    }
  }

  /** Stacked granite blocks sit on the local-high rock mask, not random low ground. */
  private createTors(chunkX: number, chunkZ: number): THREE.InstancedMesh | null {
    const entries: { x: number; y: number; z: number; scale: number; turn: number }[] = [];
    for (let candidate = 0; candidate < 4; candidate += 1) {
      const x = (chunkX + hash2(candidate, chunkZ, this.world.seed + 391)) * CHUNK_SIZE;
      const z = (chunkZ + hash2(chunkX, candidate, this.world.seed + 393)) * CHUNK_SIZE;
      const sample = this.world.sample(x, z);
      if (sample.water || sample.biome.moor < 0.7 || sample.rock < 0.55) continue;
      const scale = 1.1 + hash2(chunkX, chunkZ, this.world.seed + 395);
      const turn = hash2(chunkX, candidate, this.world.seed + 397) * Math.PI;
      let top = sample.height;
      for (let level = 0; level < 3; level += 1) {
        const blockScale = scale * (1 - level * 0.12);
        entries.push({ x, z, y: top + 1.6 * blockScale, scale: blockScale, turn: turn + level * 0.07 });
        top += 3.2 * blockScale;
      }
    }
    if (!entries.length) return null;
    const mesh = new THREE.InstancedMesh(this.torGeometry, this.rockMaterial, entries.length);
    const dummy = new THREE.Object3D();
    entries.forEach((block, index) => {
      dummy.position.set(block.x - chunkX * CHUNK_SIZE, block.y, block.z - chunkZ * CHUNK_SIZE);
      dummy.rotation.set(0, block.turn, 0);
      dummy.scale.setScalar(block.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    return mesh;
  }

  private createRocks(chunkX: number, chunkZ: number, attempts: number, originX: number, originZ: number): THREE.InstancedMesh | null {
    const entries: { x: number; y: number; z: number; scale: number; turn: number }[] = [];
    for (let index = 0; index < attempts * 2; index += 1) {
      const x = (chunkX + hash2(index, chunkZ * 17, this.world.seed + 367)) * CHUNK_SIZE;
      const z = (chunkZ + hash2(chunkX * 19, index, this.world.seed + 373)) * CHUNK_SIZE;
      const sample = this.world.sample(x, z);
      if (sample.water || hash2(index, chunkX - chunkZ, this.world.seed + 379) > sample.rock) continue;
      entries.push({ x, y: sample.height, z, scale: 0.6 + sample.rock * 1.8, turn: sample.moisture * 5 });
      if (entries.length >= attempts) break;
    }
    if (entries.length === 0) return null;
    const mesh = new THREE.InstancedMesh(this.rockGeometry, this.rockMaterial, entries.length);
    const dummy = new THREE.Object3D();
    entries.forEach((rock, index) => {
      dummy.position.set(rock.x - originX, rock.y + rock.scale * 1.5, rock.z - originZ);
      dummy.rotation.set(rock.turn * 0.3, rock.turn, rock.turn * 0.15);
      dummy.scale.set(rock.scale * 1.25, rock.scale * 0.7, rock.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }
}

import * as THREE from 'three';
import { fbm, hash2, highlandWeight, type LandscapeSample, WorldModel } from './world';

/** Snow stays white; lighting supplies the blue shade. Steep faces remain granite. */
export function snowCover(sample: LandscapeSample, slope: number, x: number, z: number, seed: number): number {
  if (sample.water || slope >= Math.tan(40 * Math.PI / 180) || sample.height < 380) return 0;
  if (sample.height >= 420) return highlandWeight(sample.mountainRegion);
  const altitude = (sample.height - 380) / 40;
  const patch = fbm(x / 85, z / 85, seed + 389, 2) * 0.5 + 0.5;
  return highlandWeight(sample.mountainRegion) * THREE.MathUtils.smoothstep(altitude, patch * 0.65, patch * 0.65 + 0.35);
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

type Tier = 'near' | 'mid' | 'far';
type TreeMode = 'near' | 'far' | 'none';
type Chunk = { group: THREE.Group; tier: Tier; descriptor: string; dispose: () => void };
type Pending = { x: number; z: number; key: string; chunkSize: number; tier: Tier; trees: TreeMode; descriptor: string };

export class TerrainStream {
  private readonly scene: THREE.Scene;
  private readonly world: WorldModel;
  private readonly chunks = new Map<string, Chunk>();
  private reach: number;
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private rawX = 0;
  private rawZ = 0;
  private pending: Pending[] = [];

  private readonly terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  // Fades the shadow to fully lit near the fixed shadow camera's edge, in place of a hard cutoff.
  private readonly shadowFadeRange = { value: new THREE.Vector2() };
  private readonly waterMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.05,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 });
  private readonly foliageMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x1f5a34, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x2e7a3e, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x5c9443, roughness: 1, flatShading: true }),
  ];
  private readonly rockMaterial = new THREE.MeshStandardMaterial({ color: 0x857e72, roughness: 1, flatShading: true });
  private readonly trunkGeometry = new THREE.CylinderGeometry(0.8, 1.35, 9, 5);
  private readonly crownGeometries = [
    new THREE.ConeGeometry(5.5, 12, 7), // layered conifer
    new THREE.IcosahedronGeometry(6.8, 1), // spreading deciduous crown
    new THREE.IcosahedronGeometry(3.7, 1), // tall, narrow tree
  ];
  private readonly rockGeometry = new THREE.DodecahedronGeometry(4.5, 0);
  // Distant trees keep the near placement, trunks, and colors with two draw calls per tile.
  private readonly farCrownGeometry = new THREE.IcosahedronGeometry(5.4, 0);
  private readonly farFoliageMaterial = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });

  // Reach is the horizontal distance from the camera's tile that must be loaded.
  constructor(scene: THREE.Scene, world: WorldModel, reach = MIN_VISIBILITY) {
    this.scene = scene;
    this.world = world;
    this.reach = reach;
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
  }

  // Distance (from the camera) at which the fixed-range shadow starts, and finishes, fading to fully lit.
  setShadowFadeRange(inner: number, outer: number): void {
    this.shadowFadeRange.value.set(inner, outer);
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

  update(x: number, z: number, buildBudget = 2): number {
    this.rawX = x;
    this.rawZ = z;
    const centerX = Math.floor(x / CHUNK_SIZE);
    const centerZ = Math.floor(z / CHUNK_SIZE);
    if (centerX !== this.centerX || centerZ !== this.centerZ) this.recenter(centerX, centerZ);
    let built = 0;
    for (; built < buildBudget && this.pending.length > 0; built += 1) {
      const next = this.pending.shift()!;
      const old = this.chunks.get(next.key);
      const chunk = this.createChunk(next);
      if (old) { this.scene.remove(old.group); old.dispose(); }
      this.chunks.set(next.key, chunk);
    }
    return built;
  }

  private recenter(centerX: number, centerZ: number): void {
    this.centerX = centerX;
    this.centerZ = centerZ;
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

    for (const [key, chunk] of this.chunks) {
      if (needed.has(key)) continue;
      this.scene.remove(chunk.group);
      chunk.dispose();
      this.chunks.delete(key);
    }
  }

  clear(): void {
    for (const chunk of this.chunks.values()) {
      this.scene.remove(chunk.group);
      chunk.dispose();
    }
    this.chunks.clear();
    this.pending = [];
  }

  dispose(): void {
    this.clear();
    this.terrainMaterial.dispose();
    this.waterMaterial.dispose();
    this.trunkMaterial.dispose();
    this.foliageMaterials.forEach((material) => material.dispose());
    this.rockMaterial.dispose();
    this.trunkGeometry.dispose();
    this.crownGeometries.forEach((geometry) => geometry.dispose());
    this.rockGeometry.dispose();
    this.farCrownGeometry.dispose();
    this.farFoliageMaterial.dispose();
  }

  private createChunk({ x: chunkX, z: chunkZ, chunkSize, tier, trees: treeMode }: Pending): Chunk {
    const detailed = tier === 'near';
    const group = new THREE.Group();
    group.name = chunkSize === CHUNK_SIZE ? `land ${chunkX},${chunkZ}` : `land far ${chunkX},${chunkZ}`;
    const config = tier === 'near' ? DETAIL : tier === 'mid' ? MID : FAR;
    const segments = config.segments;
    const step = chunkSize / segments;
    const originX = chunkX * chunkSize;
    const originZ = chunkZ * chunkSize;
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const color = new THREE.Color();
    const normal = new THREE.Vector3();
    const row = segments + 3;
    const samples: LandscapeSample[] = [];
    for (let zIndex = -1; zIndex <= segments + 1; zIndex += 1) {
      for (let xIndex = -1; xIndex <= segments + 1; xIndex += 1) {
        samples.push(this.world.sample(originX + xIndex * step, originZ + zIndex * step));
      }
    }
    const sampleAt = (xIndex: number, zIndex: number) => samples[(zIndex + 1) * row + xIndex + 1]!;
    const heightAt = (xIndex: number, zIndex: number) => sampleAt(xIndex, zIndex).height;
    const water: boolean[] = [];
    const surface: number[] = [];

    for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
      for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
        const x = originX + xIndex * step;
        const z = originZ + zIndex * step;
        const sample = sampleAt(xIndex, zIndex);
        water.push(sample.water);
        surface.push(sample.water ? sample.surface : this.dryWaterLevel(sampleAt, xIndex, zIndex));
        positions.push(x, sample.height, z);
        normal.set(
          heightAt(xIndex - 1, zIndex) - heightAt(xIndex + 1, zIndex),
          step * 2,
          heightAt(xIndex, zIndex - 1) - heightAt(xIndex, zIndex + 1),
        ).normalize();
        normals.push(normal.x, normal.y, normal.z);
        if (sample.water) color.set(0x2f6e6a);
        else if (sample.rock > 0.67) color.set(0x8a8174).lerp(new THREE.Color(0xafa28a), sample.rock - 0.67);
        else if (sample.forest > 0.55) color.set(0x2f6b3a);
        else color.set(0x6fa03c).lerp(new THREE.Color(0xb3b04a), 1 - sample.moisture);
        const hueJitter = (hash2(Math.round(x), Math.round(z), this.world.seed + 311) - 0.5) * 0.03;
        const saturationJitter = (hash2(Math.round(x), Math.round(z), this.world.seed + 312) - 0.5) * 0.12;
        const lightnessJitter = (hash2(Math.round(x), Math.round(z), this.world.seed + 313) - 0.5) * 0.06;
        color.offsetHSL(hueJitter, saturationJitter, lightnessJitter);
        if (!sample.water && sample.mountainRegion > 0) {
          const slope = Math.hypot(normal.x, normal.z) / normal.y;
          const highland = new THREE.Color(0x7da548);
          if (sample.forest > 0.55) highland.set(0x1e4e3a);
          else if (sample.height > 340 || slope > 0.5) highland.set(0x6e685e).lerp(new THREE.Color(0xafa28a), THREE.MathUtils.clamp(normal.y - 0.3, 0, 1));
          else if (sample.height > 320) highland.lerp(new THREE.Color(0x9a9489), THREE.MathUtils.smoothstep(sample.height, 320, 340));
          color.lerp(highland, highlandWeight(sample.mountainRegion));
          color.lerp(new THREE.Color(0xf2f4f7), snowCover(sample, slope, x, z, this.world.seed));
        }
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let zIndex = 0; zIndex < segments; zIndex += 1) {
      for (let xIndex = 0; xIndex < segments; xIndex += 1) {
        const a = zIndex * (segments + 1) + xIndex;
        const b = a + 1;
        const c = a + segments + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    if (!detailed) {
      // High-detail neighbors have more edge vertices. A downward skirt hides
      // interpolation cracks without multiplying the far-field mesh density.
      const edge = (vertices: number[], outward: boolean) => {
        for (let i = 0; i < vertices.length; i += 1) {
          const top = vertices[i]!;
          const base = top * 3;
          const bottom = positions.length / 3;
          positions.push(positions[base]!, positions[base + 1]! - 140, positions[base + 2]!);
          normals.push(normals[base]!, normals[base + 1]!, normals[base + 2]!);
          colors.push(colors[base]!, colors[base + 1]!, colors[base + 2]!);
          if (i > 0) {
            const prev = vertices[i - 1]!;
            const prevBottom = bottom - 1;
            if (outward) indices.push(prev, top, prevBottom, top, bottom, prevBottom);
            else indices.push(prev, prevBottom, top, top, prevBottom, bottom);
          }
        }
      };
      edge(Array.from({ length: segments + 1 }, (_, i) => i), true);
      edge(Array.from({ length: segments + 1 }, (_, i) => segments * (segments + 1) + i), false);
      edge(Array.from({ length: segments + 1 }, (_, i) => i * (segments + 1)), false);
      edge(Array.from({ length: segments + 1 }, (_, i) => i * (segments + 1) + segments), true);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const terrain = new THREE.Mesh(geometry, this.terrainMaterial);
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    group.add(terrain);

    const waterGeometry = this.createWaterGeometry(originX, originZ, chunkSize, segments, water, surface);
    if (waterGeometry) group.add(new THREE.Mesh(waterGeometry, this.waterMaterial));

    const treeObjects = treeMode === 'near' ? this.createTrees(originX, originZ, TREE_SPACING)
      : treeMode === 'far' ? this.createFarTrees(originX, originZ)
      : [];
    treeObjects.forEach((object) => group.add(object));
    const rocks = this.createRocks(chunkX, chunkZ, config.rocks);
    if (rocks) group.add(rocks);

    this.scene.add(group);
    return {
      group,
      tier,
      descriptor: `${tier}:${treeMode}`,
      dispose: () => {
        geometry.dispose();
        waterGeometry?.dispose();
        treeObjects.forEach((object) => object.dispose());
        rocks?.dispose();
      },
    };
  }

  // A dry vertex at a water edge takes its wet neighbors' level, so river and lake edges stay flat.
  private dryWaterLevel(sampleAt: (xIndex: number, zIndex: number) => LandscapeSample, xIndex: number, zIndex: number): number {
    let sum = 0;
    let count = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const neighbor = sampleAt(xIndex + dx, zIndex + dz);
        if (!neighbor.water) continue;
        sum += neighbor.surface;
        count += 1;
      }
    }
    return count > 0 ? sum / count : sampleAt(xIndex, zIndex).surface;
  }

  private createWaterGeometry(originX: number, originZ: number, chunkSize: number, segments: number, water: boolean[], surface: number[]): THREE.BufferGeometry | null {
    const step = chunkSize / segments;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const waterColor = new THREE.Color();
    for (let iz = 0; iz < segments; iz += 1) {
      for (let ix = 0; ix < segments; ix += 1) {
        const a = iz * (segments + 1) + ix;
        const corners = [a, a + 1, a + segments + 1, a + segments + 2];
        const x = originX + ix * step;
        const z = originZ + iz * step;
        if (!corners.some((corner) => water[corner])) continue;
        const [y0, y1, y2, y3] = corners.map((corner) => surface[corner]! + 0.15);
        const base = positions.length / 3;
        positions.push(x, y0!, z, x + step, y1!, z, x, y2!, z + step, x + step, y3!, z + step);
        for (const [dx, dz] of [[0, 0], [step, 0], [0, step], [step, step]]) {
          const sample = this.world.sample(x + dx!, z + dz!);
          waterColor.set(0x2a8fa8);
          if (!sample.river) waterColor.lerp(new THREE.Color(0x2a7fa0), highlandWeight(sample.mountainRegion));
          colors.push(waterColor.r, waterColor.g, waterColor.b);
        }
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    if (positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private createTrees(originX: number, originZ: number, spacing: number): THREE.InstancedMesh[] {
    const trees = this.world.treesInArea(originX, originZ, CHUNK_SIZE, spacing);
    if (trees.length === 0) return [];
    const dummy = new THREE.Object3D();
    const trunks = new THREE.InstancedMesh(this.trunkGeometry, this.trunkMaterial, trees.length);
    trees.forEach((tree, index) => {
      dummy.position.set(tree.x, tree.y + 4.5 * tree.scale, tree.z);
      dummy.rotation.set(0, tree.turn, 0);
      dummy.scale.setScalar(tree.scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;
    trunks.castShadow = true;
    const meshes: THREE.InstancedMesh[] = [trunks];
    for (let kind = 0; kind < this.crownGeometries.length; kind += 1) {
      const ofKind = trees.filter((tree) => tree.kind === kind);
      if (ofKind.length === 0) continue;
      const crowns = new THREE.InstancedMesh(this.crownGeometries[kind]!, this.foliageMaterials[kind]!, ofKind.length);
      const upper = kind === 0
        ? new THREE.InstancedMesh(this.crownGeometries[0]!, this.foliageMaterials[0]!, ofKind.length)
        : null;
      ofKind.forEach((tree, index) => {
        dummy.position.set(tree.x, tree.y + (kind === 0 ? 14 : kind === 1 ? 14 : 18) * tree.scale, tree.z);
        dummy.rotation.set(0, tree.turn, 0);
        dummy.scale.set(tree.scale, tree.scale * (kind === 0 ? 1.4 : kind === 1 ? 0.83 : 2.6), tree.scale);
        dummy.updateMatrix();
        crowns.setMatrixAt(index, dummy.matrix);
        const base = this.foliageMaterials[kind]!.color;
        const tint = base.clone().lerp(new THREE.Color(0x1e4e3a), highlandWeight(this.world.sample(tree.x, tree.z).mountainRegion));
        const multiplier = new THREE.Color().setRGB(tint.r / base.r, tint.g / base.g, tint.b / base.b);
        crowns.setColorAt(index, multiplier);
        upper?.setColorAt(index, multiplier);
        if (upper) {
          dummy.position.y = tree.y + 22 * tree.scale;
          dummy.scale.setScalar(tree.scale * 0.85);
          dummy.updateMatrix();
          upper.setMatrixAt(index, dummy.matrix);
        }
      });
      crowns.instanceMatrix.needsUpdate = true;
      crowns.castShadow = true;
      meshes.push(crowns);
      if (upper) {
        upper.instanceMatrix.needsUpdate = true;
        upper.castShadow = true;
        meshes.push(upper);
      }
    }
    return meshes;
  }

  private createFarTrees(originX: number, originZ: number): THREE.InstancedMesh[] {
    const trees = this.world.treesInArea(originX, originZ, CHUNK_SIZE, TREE_SPACING);
    if (trees.length === 0) return [];
    const trunks = new THREE.InstancedMesh(this.trunkGeometry, this.trunkMaterial, trees.length);
    const crowns = new THREE.InstancedMesh(this.farCrownGeometry, this.farFoliageMaterial, trees.length);
    const dummy = new THREE.Object3D();
    trees.forEach((tree, index) => {
      dummy.position.set(tree.x, tree.y + 4.5 * tree.scale, tree.z);
      dummy.rotation.set(0, tree.turn, 0);
      dummy.scale.setScalar(tree.scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);
      dummy.position.y = tree.y + (tree.kind === 2 ? 18 : 14) * tree.scale;
      dummy.scale.set(tree.scale * (tree.kind === 2 ? 0.68 : 1.2), tree.scale * (tree.kind === 0 ? 1.55 : tree.kind === 1 ? 1.05 : 1.8), tree.scale * (tree.kind === 2 ? 0.68 : 1.2));
      dummy.updateMatrix();
      crowns.setMatrixAt(index, dummy.matrix);
      crowns.setColorAt(index, this.foliageMaterials[tree.kind]!.color.clone()
        .lerp(new THREE.Color(0x1e4e3a), highlandWeight(this.world.sample(tree.x, tree.z).mountainRegion)));
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    trunks.castShadow = true;
    crowns.castShadow = true;
    return [trunks, crowns];
  }

  private createRocks(chunkX: number, chunkZ: number, attempts: number): THREE.InstancedMesh | null {
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
      dummy.position.set(rock.x, rock.y + rock.scale * 1.5, rock.z);
      dummy.rotation.set(rock.turn * 0.3, rock.turn, rock.turn * 0.15);
      dummy.scale.set(rock.scale * 1.25, rock.scale * 0.7, rock.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }
}

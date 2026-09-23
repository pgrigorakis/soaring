import * as THREE from 'three';
import { hash2, type LandscapeSample, WorldModel } from './world';

export type QualityName = 'low' | 'medium' | 'high';
export const QUALITY: Record<QualityName, { radius: number; segments: number; trees: number; rocks: number; pixelRatio: number }> = {
  low: { radius: 2, segments: 22, trees: 18, rocks: 4, pixelRatio: 1 },
  medium: { radius: 2, segments: 32, trees: 34, rocks: 7, pixelRatio: 1.35 },
  high: { radius: 3, segments: 40, trees: 52, rocks: 10, pixelRatio: 1.75 },
};

export const CHUNK_SIZE = 360;

type Chunk = { group: THREE.Group; dispose: () => void };

export class TerrainStream {
  private readonly scene: THREE.Scene;
  private readonly world: WorldModel;
  private readonly chunks = new Map<string, Chunk>();
  private quality: QualityName;
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private pending: { x: number; z: number; key: string }[] = [];

  private readonly terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  private readonly waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x477d8b,
    roughness: 0.38,
    metalness: 0.05,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x584634, roughness: 1 });
  private readonly foliageMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x31563b, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x426846, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x56734a, roughness: 1, flatShading: true }),
  ];
  private readonly rockMaterial = new THREE.MeshStandardMaterial({ color: 0x77776d, roughness: 1, flatShading: true });
  private readonly trunkGeometry = new THREE.CylinderGeometry(0.8, 1.35, 9, 5);
  private readonly crownGeometry = new THREE.IcosahedronGeometry(5.4, 1);
  private readonly rockGeometry = new THREE.DodecahedronGeometry(4.5, 0);

  constructor(scene: THREE.Scene, world: WorldModel, quality: QualityName) {
    this.scene = scene;
    this.world = world;
    this.quality = quality;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  setQuality(quality: QualityName): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.clear();
    this.centerX = Number.NaN;
    this.centerZ = Number.NaN;
  }

  update(x: number, z: number, buildBudget = 2): void {
    const centerX = Math.floor(x / CHUNK_SIZE);
    const centerZ = Math.floor(z / CHUNK_SIZE);
    if (centerX !== this.centerX || centerZ !== this.centerZ) this.recenter(centerX, centerZ);
    for (let built = 0; built < buildBudget && this.pending.length > 0; built += 1) {
      const next = this.pending.shift()!;
      this.chunks.set(next.key, this.createChunk(next.x, next.z));
    }
  }

  private recenter(centerX: number, centerZ: number): void {
    this.centerX = centerX;
    this.centerZ = centerZ;
    const needed = new Set<string>();
    const radius = QUALITY[this.quality].radius;
    this.pending = [];
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const key = `${centerX + dx},${centerZ + dz}`;
        needed.add(key);
        if (!this.chunks.has(key)) this.pending.push({ x: centerX + dx, z: centerZ + dz, key });
      }
    }
    this.pending.sort((a, b) => Math.hypot(a.x - centerX, a.z - centerZ) - Math.hypot(b.x - centerX, b.z - centerZ));

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
    this.crownGeometry.dispose();
    this.rockGeometry.dispose();
  }

  private createChunk(chunkX: number, chunkZ: number): Chunk {
    const group = new THREE.Group();
    group.name = `land ${chunkX},${chunkZ}`;
    const config = QUALITY[this.quality];
    const segments = config.segments;
    const step = CHUNK_SIZE / segments;
    const originX = chunkX * CHUNK_SIZE;
    const originZ = chunkZ * CHUNK_SIZE;
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

    for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
      for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
        const x = originX + xIndex * step;
        const z = originZ + zIndex * step;
        const sample = sampleAt(xIndex, zIndex);
        water.push(sample.water);
        positions.push(x, sample.height, z);
        normal.set(
          heightAt(xIndex - 1, zIndex) - heightAt(xIndex + 1, zIndex),
          step * 2,
          heightAt(xIndex, zIndex - 1) - heightAt(xIndex, zIndex + 1),
        ).normalize();
        normals.push(normal.x, normal.y, normal.z);
        if (sample.water) color.set(0x586957);
        else if (sample.rock > 0.67) color.set(0x77766c).lerp(new THREE.Color(0x8a8374), sample.rock - 0.67);
        else if (sample.forest > 0.55) color.set(0x456345);
        else color.set(0x718258).lerp(new THREE.Color(0x8c925f), 1 - sample.moisture);
        const tint = (hash2(Math.round(x), Math.round(z), this.world.seed + 313) - 0.5) * 0.055;
        color.offsetHSL(0, 0, tint);
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
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const terrain = new THREE.Mesh(geometry, this.terrainMaterial);
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    group.add(terrain);

    const waterGeometry = this.createWaterGeometry(originX, originZ, segments, water);
    if (waterGeometry) group.add(new THREE.Mesh(waterGeometry, this.waterMaterial));

    const treeObjects = this.createTrees(chunkX, chunkZ, config.trees);
    treeObjects.forEach((object) => group.add(object));
    const rocks = this.createRocks(chunkX, chunkZ, config.rocks);
    if (rocks) group.add(rocks);

    this.scene.add(group);
    return {
      group,
      dispose: () => {
        geometry.dispose();
        waterGeometry?.dispose();
        treeObjects.forEach((object) => object.dispose());
        rocks?.dispose();
      },
    };
  }

  private createWaterGeometry(originX: number, originZ: number, segments: number, water: boolean[]): THREE.BufferGeometry | null {
    const step = CHUNK_SIZE / segments;
    const y = this.world.waterLevel + 0.15;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let iz = 0; iz < segments; iz += 1) {
      for (let ix = 0; ix < segments; ix += 1) {
        const a = iz * (segments + 1) + ix;
        if (!water[a] && !water[a + 1] && !water[a + segments + 1] && !water[a + segments + 2]) continue;
        const x = originX + ix * step;
        const z = originZ + iz * step;
        const base = positions.length / 3;
        positions.push(x, y, z, x + step, y, z, x, y, z + step, x + step, y, z + step);
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    if (positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private createTrees(chunkX: number, chunkZ: number, attempts: number): THREE.InstancedMesh[] {
    const counts = [0, 0, 0];
    const candidates: { x: number; y: number; z: number; scale: number; kind: number; turn: number }[] = [];
    for (let index = 0; index < attempts * 2; index += 1) {
      const x = (chunkX + hash2(chunkX * 97 + index, chunkZ, this.world.seed + 337)) * CHUNK_SIZE;
      const z = (chunkZ + hash2(chunkX, chunkZ * 89 + index, this.world.seed + 347)) * CHUNK_SIZE;
      const sample = this.world.sample(x, z);
      const acceptance = hash2(chunkX + index, chunkZ - index, this.world.seed + 349);
      if (sample.water || sample.rock > 0.72 || acceptance > sample.forest * 1.18 || candidates.length >= attempts) continue;
      const kind = Math.min(2, Math.floor(hash2(index, chunkX + chunkZ, this.world.seed + 353) * 3));
      const scale = 0.72 + hash2(index, chunkZ, this.world.seed + 359) * 0.72;
      candidates.push({ x, y: sample.height, z, scale, kind, turn: acceptance * Math.PI * 2 });
      counts[kind] = (counts[kind] ?? 0) + 1;
    }

    const dummy = new THREE.Object3D();
    const meshes: THREE.InstancedMesh[] = [];
    for (let kind = 0; kind < 3; kind += 1) {
      const count = counts[kind] ?? 0;
      if (count === 0) continue;
      const trunks = new THREE.InstancedMesh(this.trunkGeometry, this.trunkMaterial, count);
      const crowns = new THREE.InstancedMesh(this.crownGeometry, this.foliageMaterials[kind]!, count);
      let instance = 0;
      for (const tree of candidates) {
        if (tree.kind !== kind) continue;
        dummy.position.set(tree.x, tree.y + 4.5 * tree.scale, tree.z);
        dummy.rotation.set(0, tree.turn, 0);
        dummy.scale.set(tree.scale, tree.scale, tree.scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(instance, dummy.matrix);
        dummy.position.y = tree.y + 11.5 * tree.scale;
        dummy.scale.set(tree.scale * 1.15, tree.scale * (kind === 0 ? 1.42 : 1.08), tree.scale * 1.15);
        dummy.updateMatrix();
        crowns.setMatrixAt(instance, dummy.matrix);
        instance += 1;
      }
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      trunks.castShadow = true;
      crowns.castShadow = true;
      meshes.push(trunks, crowns);
    }
    return meshes;
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

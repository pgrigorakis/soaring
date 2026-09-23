import * as THREE from 'three';
import { hash2, type LandscapeSample, WorldModel } from './world';

export type QualityName = 'low' | 'medium' | 'high';
export const QUALITY: Record<QualityName, { radius: number; segments: number; treeSpacing: number; rocks: number; pixelRatio: number }> = {
  low: { radius: 2, segments: 22, treeSpacing: 68, rocks: 4, pixelRatio: 1 },
  medium: { radius: 2, segments: 32, treeSpacing: 44, rocks: 7, pixelRatio: 1.35 },
  high: { radius: 3, segments: 40, treeSpacing: 29, rocks: 10, pixelRatio: 1.75 },
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
  private readonly crownGeometries = [
    new THREE.ConeGeometry(5.5, 12, 7), // layered conifer
    new THREE.IcosahedronGeometry(6.8, 1), // spreading deciduous crown
    new THREE.IcosahedronGeometry(3.7, 1), // tall, narrow tree
  ];
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
    this.crownGeometries.forEach((geometry) => geometry.dispose());
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

    const treeObjects = this.createTrees(originX, originZ, config.treeSpacing);
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

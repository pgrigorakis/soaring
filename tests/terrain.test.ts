import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, MAX_VISIBILITY, MIN_VISIBILITY, TerrainStream } from '../src/terrain';
import { WorldModel } from '../src/world';

const FAR_CHUNK_SIZE = CHUNK_SIZE * 4;

function expectLoadedWithin(scene: THREE.Scene, terrain: TerrainStream, x: number, z: number): void {
  const covered = terrain.coveredDistance(x, z);
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 90) {
    const px = x + Math.cos(angle) * (covered - 1);
    const pz = z + Math.sin(angle) * (covered - 1);
    if (covered <= 0) return;
    const fine = scene.getObjectByName(`land ${Math.floor(px / CHUNK_SIZE)},${Math.floor(pz / CHUNK_SIZE)}`);
    const far = scene.getObjectByName(`land far ${Math.floor(px / FAR_CHUNK_SIZE)},${Math.floor(pz / FAR_CHUNK_SIZE)}`);
    expect(fine ?? far).toBeDefined();
  }
}

function instances(group: THREE.Object3D, geometry: abstract new (...args: never[]) => THREE.BufferGeometry): number {
  return group.children.reduce((sum, child) =>
    sum + (child instanceof THREE.InstancedMesh && child.geometry instanceof geometry ? child.count : 0), 0);
}
const treeCrowns = (group: THREE.Object3D) => instances(group, THREE.IcosahedronGeometry);
const treeTrunks = (group: THREE.Object3D) => group.children.reduce((sum, child) =>
  sum + (child instanceof THREE.InstancedMesh && child.geometry.type === 'CylinderGeometry' ? child.count : 0), 0);

describe('terrain streaming', () => {
  it('streams nearest first within a time budget and covers the reach', () => {
    const scene = new THREE.Scene();
    const terrain = new TerrainStream(scene, new WorldModel(80231));
    const x = CHUNK_SIZE * 0.99;
    const z = CHUNK_SIZE * 0.99;
    terrain.update(x, z);
    expect(terrain.pendingCount).toBeGreaterThan(0);
    expect(terrain.coveredDistance(x, z)).toBeLessThan(MIN_VISIBILITY);
    expectLoadedWithin(scene, terrain, x, z);
    while (terrain.pendingCount) terrain.update(x, z);
    expect(terrain.chunkCount).toBe(25);
    expect(scene.children[0]?.name).toBe('land 0,0');
    expect(terrain.coveredDistance(x, z)).toBe(MIN_VISIBILITY);
    expectLoadedWithin(scene, terrain, x, z);
    terrain.dispose();
  });

  it('keeps haze on loaded tiles while extending the reach, including after recentering', () => {
    const scene = new THREE.Scene();
    const terrain = new TerrainStream(scene, new WorldModel(80231));
    const reach = MAX_VISIBILITY * 1.3;
    const radius = Math.ceil(reach / CHUNK_SIZE);
    const x = CHUNK_SIZE * 0.5;
    const z = CHUNK_SIZE * 0.5;
    terrain.update(x, z, 25);
    terrain.setReach(reach);
    expect(terrain.coveredDistance(x, z)).toBeLessThan(reach);
    // Test-only: a larger millisecond budget reduces test bookkeeping.
    // Production frames use 4 ms, or 2 ms in Low power.
    const testBuildBudget = 50;
    let iterations = 0;
    while (terrain.pendingCount) {
      terrain.update(x, z, testBuildBudget);
      iterations += 1;
      if (iterations % 5 === 0) expectLoadedWithin(scene, terrain, x, z);
    }
    expect(terrain.chunkCount).toBeLessThan((2 * radius + 1) ** 2 * 0.9);
    expect(terrain.coveredDistance(x, z)).toBe(reach);
    expectLoadedWithin(scene, terrain, x, z);
    terrain.update(x + CHUNK_SIZE * 2, z);
    expect(terrain.coveredDistance(x + CHUNK_SIZE * 2, z)).toBeLessThan(reach);
    expectLoadedWithin(scene, terrain, x + CHUNK_SIZE * 2, z);
    terrain.setReach(MIN_VISIBILITY);
    expect(terrain.chunkCount).toBeLessThanOrEqual(25);
    terrain.dispose();
  }, 20_000); // Full visibility builds are CPU-bound on the shared CI runner.

  it('gives distant tiles the same trees and shadows as detailed tiles', () => {
    const scene = new THREE.Scene();
    const world = new WorldModel(80231);
    const terrain = new TerrainStream(scene, world, MAX_VISIBILITY);
    const spot = { x: 0, z: 0 };
    for (let z = -6; z <= 6; z += 1) {
      for (let x = -6; x <= 6; x += 1) {
        if (world.treesInArea((x + 5) * CHUNK_SIZE, z * CHUNK_SIZE, CHUNK_SIZE, 29).length > 5) {
          spot.x = x;
          spot.z = z;
        }
      }
    }
    terrain.update((spot.x + 0.5) * CHUNK_SIZE, (spot.z + 0.5) * CHUNK_SIZE, Infinity);
    const far = scene.getObjectByName(`land ${spot.x + 5},${spot.z}`)!;
    expect(far).toBeDefined();
    const farTrees = treeCrowns(far);
    expect(treeTrunks(far)).toBe(farTrees);
    far.traverse((object) => { if (object instanceof THREE.Mesh && !object.material.transparent) expect(object.castShadow).toBe(true); });
    const name = far.name;
    terrain.update((spot.x + 1.5) * CHUNK_SIZE, (spot.z + 0.5) * CHUNK_SIZE, Infinity);
    const detailed = scene.getObjectByName(name)!;
    expect(detailed).not.toBe(far);
    expect(treeTrunks(detailed)).toBe(farTrees);
    terrain.dispose();
  }, 20_000);

  it('renders several distinct instanced tree silhouettes at generated world positions', () => {
    const scene = new THREE.Scene();
    const world = new WorldModel(80231);
    const terrain = new TerrainStream(scene, world);
    const forest = Array.from({ length: 225 }, (_, index) => {
      const x = (index % 15) - 12;
      const z = Math.floor(index / 15) - 6;
      return { x, z, trees: world.treesInArea(x * CHUNK_SIZE, z * CHUNK_SIZE, CHUNK_SIZE, 29) };
    }).find((cell) => cell.trees.length > 8 && new Set(cell.trees.map((tree) => tree.kind)).size === 3)!;
    terrain.update((forest.x + 0.5) * CHUNK_SIZE, (forest.z + 0.5) * CHUNK_SIZE, Infinity);
    const chunk = scene.getObjectByName(`land ${forest.x},${forest.z}`)!;
    const trees = forest.trees;
    const instances = chunk.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    const trunks = instances.find((mesh) => mesh.geometry.type === 'CylinderGeometry')!;
    expect(trunks.count).toBe(trees.length);
    expect(instances.some((mesh) => mesh.geometry.type === 'ConeGeometry')).toBe(true);
    expect(instances.filter((mesh) => mesh.geometry.type === 'IcosahedronGeometry').length).toBe(2);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const renderedPositions = Array.from({ length: trunks.count }, (_, index) => {
      trunks.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      return [position.x, position.z];
    });
    expect(renderedPositions).toEqual(trees.map((tree) => [
      Math.fround(tree.x - chunk.position.x),
      Math.fround(tree.z - chunk.position.z),
    ]));
    terrain.dispose();
  });

  it('matches terrain and river water across a chunk seam built by separate streams', () => {
    const seam = 10 * CHUNK_SIZE;
    const probe = new WorldModel(448122);
    const chunkZ = Array.from({ length: 21 }, (_, i) => i - 10)
      .find((z) => Array.from({ length: 41 }, (_, i) => probe.sample(seam, (z + i / 40) * CHUNK_SIZE).river).some(Boolean))!;
    expect(chunkZ).toBeDefined();
    // Each side comes from its own world and stream, built in a different order.
    const edge = (chunkX: number, x: number) => {
      const scene = new THREE.Scene();
      const terrain = new TerrainStream(scene, new WorldModel(448122));
      terrain.update((chunkX + 0.5) * CHUNK_SIZE, (chunkZ + 0.5) * CHUNK_SIZE, Infinity);
      const chunk = scene.getObjectByName(`land ${chunkX},${chunkZ}`)!;
      expect(chunk.position.x).toBe(chunkX * CHUNK_SIZE);
      expect(chunk.position.z).toBe(chunkZ * CHUNK_SIZE);
      const [ground, water] = chunk.children as THREE.Mesh[];
      const points = (mesh: THREE.Mesh) => {
        const position = mesh.geometry.getAttribute('position');
        return new Map(Array.from({ length: position.count }, (_, i) => [
          position.getX(i) + chunk.position.x,
          position.getY(i) + chunk.position.y,
          position.getZ(i) + chunk.position.z,
        ])
          .filter(([px]) => px === x).map(([, y, z]) => [z!, y!]));
      };
      const result = { ground: points(ground!), water: points(water!) };
      terrain.dispose();
      return result;
    };
    const west = edge(9, seam);
    const east = edge(10, seam);
    expect(west.ground.size).toBe(41);
    expect(west.ground).toEqual(east.ground);
    // Each side draws water only on its own quads; wherever both have a seam vertex, the surface matches.
    const shared = [...west.water.keys()].filter((z) => east.water.has(z));
    expect(shared.length).toBeGreaterThan(0);
    for (const z of shared) expect(west.water.get(z)).toBe(east.water.get(z));
  });
});

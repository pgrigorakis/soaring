import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, MAX_VISIBILITY, MIN_VISIBILITY, TerrainStream } from '../src/terrain';
import { WorldModel } from '../src/world';

describe('terrain streaming', () => {
  it('builds at most two tiles per frame, nearest first, and covers the near square', () => {
    const scene = new THREE.Scene();
    const terrain = new TerrainStream(scene, new WorldModel(80231));
    const x = CHUNK_SIZE * 0.99;
    const z = CHUNK_SIZE * 0.99;
    terrain.update(x, z);
    expect(terrain.chunkCount).toBe(2);
    expect(scene.getObjectByName('land 0,0')).toBeDefined();
    expect(terrain.coveredDistance(x, z)).toBeLessThan(MIN_VISIBILITY);
    for (let frame = 0; frame < 25; frame += 1) terrain.update(x, z);
    expect(terrain.chunkCount).toBe(49);
    expect(terrain.coveredDistance(x, z)).toBe(MIN_VISIBILITY);
    terrain.dispose();
  });

  it('limits the haze to loaded tiles while extending fivefold, including after recentering', () => {
    const terrain = new TerrainStream(new THREE.Scene(), new WorldModel(80231));
    const x = CHUNK_SIZE * 0.5;
    const z = CHUNK_SIZE * 0.5;
    terrain.update(x, z, 49);
    terrain.setVisibility(MAX_VISIBILITY);
    expect(terrain.coveredDistance(x, z)).toBeLessThan(MAX_VISIBILITY);
    expect(terrain.pendingCount).toBe((2 * terrain.radius + 1) ** 2 - 49);
    let previous = terrain.chunkCount;
    while (terrain.pendingCount) {
      terrain.update(x, z);
      expect(terrain.chunkCount - previous).toBeLessThanOrEqual(2);
      previous = terrain.chunkCount;
    }
    expect(terrain.chunkCount).toBe(23 ** 2);
    expect(terrain.coveredDistance(x, z)).toBe(MAX_VISIBILITY);
    terrain.update(x + CHUNK_SIZE * 2, z);
    expect(terrain.chunkCount).toBeLessThanOrEqual(23 ** 2);
    expect(terrain.coveredDistance(x + CHUNK_SIZE * 2, z)).toBeLessThan(MAX_VISIBILITY);
    terrain.setVisibility(MIN_VISIBILITY);
    expect(terrain.chunkCount).toBeLessThanOrEqual(49);
    terrain.dispose();
  });

  it('renders several distinct instanced tree silhouettes at generated world positions', () => {
    const scene = new THREE.Scene();
    const world = new WorldModel(80231);
    const terrain = new TerrainStream(scene, world);
    terrain.update(-4 * CHUNK_SIZE + 1, -CHUNK_SIZE + 1, 1);
    const chunk = scene.getObjectByName('land -4,-1')!;
    const trees = world.treesInArea(-4 * CHUNK_SIZE, -CHUNK_SIZE, CHUNK_SIZE, 29);
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
    expect(renderedPositions).toEqual(trees.map((tree) => [Math.fround(tree.x), Math.fround(tree.z)]));
    terrain.dispose();
  });
});

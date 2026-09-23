import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, QUALITY, TerrainStream } from '../src/terrain';
import { WorldModel } from '../src/world';

describe('terrain streaming', () => {
  it('builds a bounded number of chunks per update, nearest first, until the full square is covered', () => {
    const scene = new THREE.Scene();
    const terrain = new TerrainStream(scene, new WorldModel(80231), 'medium');
    const x = CHUNK_SIZE * 0.99;
    const z = CHUNK_SIZE * 0.99;
    terrain.update(x, z);
    expect(terrain.chunkCount).toBe(2);
    expect(scene.getObjectByName('land 0,0')).toBeDefined();
    for (let frame = 0; frame < 20; frame += 1) terrain.update(x, z);
    expect(terrain.chunkCount).toBe(25);
    expect(scene.getObjectByName('land 2,2')).toBeDefined();
    expect(scene.getObjectByName('land -2,-2')).toBeDefined();
    terrain.dispose();
  });

  it('renders several distinct instanced tree silhouettes at generated world positions', () => {
    const scene = new THREE.Scene();
    const world = new WorldModel(80231);
    const terrain = new TerrainStream(scene, world, 'high');
    terrain.update(-4 * CHUNK_SIZE + 1, -CHUNK_SIZE + 1, 1);
    const chunk = scene.getObjectByName('land -4,-1')!;
    const trees = world.treesInArea(-4 * CHUNK_SIZE, -CHUNK_SIZE, CHUNK_SIZE, QUALITY.high.treeSpacing);
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

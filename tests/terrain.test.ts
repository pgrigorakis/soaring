import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, TerrainStream } from '../src/terrain';
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
});

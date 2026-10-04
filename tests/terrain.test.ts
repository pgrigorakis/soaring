import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, MAX_VISIBILITY, MIN_VISIBILITY, TerrainStream } from '../src/terrain';
import { WorldModel } from '../src/world';


/** Every point the haze leaves clear lies on a displayed ground level. */
function expectGroundWithin(scene: THREE.Scene, terrain: TerrainStream, x: number, z: number): void {
  const covered = terrain.coveredDistance(x, z);
  if (covered <= 0) return;
  const levels = scene.children.filter((child) => child.name.startsWith('ground ') && child.visible)
    .map((level) => new THREE.Box3().setFromObject(level));
  expect(levels.length).toBeGreaterThan(0);
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 90) {
    const px = x + Math.cos(angle) * covered;
    const pz = z + Math.sin(angle) * covered;
    expect(levels.some((box) => px >= box.min.x && px <= box.max.x && pz >= box.min.z && pz <= box.max.z)).toBe(true);
  }
}

/** World positions of a shared pool's live instances inside one fine tile. */
function pooled(scene: THREE.Object3D, name: string, tile: THREE.Object3D): THREE.Vector3[] {
  const pool = scene.getObjectByName(name) as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  const positions: THREE.Vector3[] = [];
  for (let index = 0; index < pool.count; index += 1) {
    pool.getMatrixAt(index, matrix);
    if (matrix.determinant() === 0) continue;
    const position = new THREE.Vector3().setFromMatrixPosition(matrix).add(pool.position);
    if (position.x >= tile.position.x && position.x < tile.position.x + CHUNK_SIZE
      && position.z >= tile.position.z && position.z < tile.position.z + CHUNK_SIZE) positions.push(position);
  }
  return positions;
}

describe('terrain streaming', () => {
  it('streams nearest first within a time budget and covers the reach', () => {
    const scene = new THREE.Scene();
    const terrain = new TerrainStream(scene, new WorldModel(80231));
    const x = CHUNK_SIZE * 0.99;
    const z = CHUNK_SIZE * 0.99;
    terrain.update(x, z);
    expect(terrain.pendingCount).toBeGreaterThan(0);
    expect(terrain.coveredDistance(x, z)).toBeLessThan(MIN_VISIBILITY);
    expectGroundWithin(scene, terrain, x, z);
    while (terrain.pendingCount) terrain.update(x, z);
    expect(terrain.chunkCount).toBe(25);
    expect(scene.children.find((child) => child.name.startsWith('land'))?.name).toBe('land 0,0');
    expect(terrain.coveredDistance(x, z)).toBe(MIN_VISIBILITY);
    expectGroundWithin(scene, terrain, x, z);
    terrain.dispose();
  });

  it('keeps haze on displayed ground while extending the reach, including after recentering', () => {
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
      if (iterations % 5 === 0) expectGroundWithin(scene, terrain, x, z);
    }
    expect(terrain.chunkCount).toBeLessThan((2 * radius + 1) ** 2 * 0.9);
    expect(terrain.coveredDistance(x, z)).toBe(reach);
    expectGroundWithin(scene, terrain, x, z);
    terrain.update(x + CHUNK_SIZE * 2, z);
    expect(terrain.coveredDistance(x + CHUNK_SIZE * 2, z)).toBeLessThan(reach);
    expectGroundWithin(scene, terrain, x + CHUNK_SIZE * 2, z);
    terrain.setReach(MIN_VISIBILITY);
    expect(terrain.chunkCount).toBeLessThanOrEqual(25);
    terrain.dispose();
  }, 20_000); // Full visibility builds are CPU-bound on the shared CI runner.

  it('gives distant tiles the same trees as detailed tiles', () => {
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
    const farTrees = pooled(scene, 'mid tree crowns', far).length;
    expect(farTrees).toBeGreaterThan(5);
    expect(pooled(scene, 'mid tree trunks', far).length).toBe(farTrees);
    far.traverse((object) => { if (object instanceof THREE.Mesh && !object.material.transparent) expect(object.castShadow).toBe(true); });
    // Mid-tier tiles begin beyond the 600 m shadow camera, so only near trees enter the shadow pass.
    for (const name of ['near tree trunks', 'near cones', 'near broadleaf', 'near birch']) {
      expect((scene.getObjectByName(name) as THREE.Mesh).castShadow).toBe(true);
    }
    const name = far.name;
    terrain.update((spot.x + 1.5) * CHUNK_SIZE, (spot.z + 0.5) * CHUNK_SIZE, Infinity);
    const detailed = scene.getObjectByName(name)!;
    expect(detailed).not.toBe(far);
    expect(pooled(scene, 'near tree trunks', detailed).length).toBe(farTrees);
    expect(pooled(scene, 'mid tree trunks', detailed)).toEqual([]);
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
    const trunks = pooled(scene, 'near tree trunks', chunk);
    expect(trunks.length).toBe(trees.length);
    // Conifers draw two cones; the other kinds draw one crown each.
    const kinds = [0, 1, 2].map((kind) => trees.filter((tree) => tree.kind === kind).length);
    expect(pooled(scene, 'near cones', chunk).length).toBe(kinds[0]! * 2);
    expect(pooled(scene, 'near broadleaf', chunk).length).toBe(kinds[1]);
    expect(pooled(scene, 'near birch', chunk).length).toBe(kinds[2]);
    const anchor = scene.getObjectByName('near tree trunks')!.position;
    expect(trunks.map((position) => [position.x, position.z])).toEqual(trees.map((tree) => [
      Math.fround(tree.x - anchor.x) + anchor.x,
      Math.fround(tree.z - anchor.z) + anchor.z,
    ]));
    terrain.dispose();
  });

  // Failure modes: a re-anchored pool shifts trees, a cleared stream leaks slots, or a full pool drops trees.
  it('keeps pooled trees in place across re-anchoring and frees their slots', () => {
    const scene = new THREE.Scene();
    const world = new WorldModel(80231);
    const terrain = new TerrainStream(scene, world);
    const cell = Array.from({ length: 400 }, (_, index) => ({ x: 40 + (index % 20), z: Math.floor(index / 20) - 10 }))
      .find(({ x, z }) => world.treesInArea(x * CHUNK_SIZE, z * CHUNK_SIZE, CHUNK_SIZE, 29).length > 8)!;
    terrain.update(0, 0, Infinity);
    terrain.update((cell.x + 0.5) * CHUNK_SIZE, (cell.z + 0.5) * CHUNK_SIZE, Infinity);
    const pool = scene.getObjectByName('near tree trunks')!;
    expect(Math.hypot(pool.position.x, pool.position.z)).toBeGreaterThan(8000);
    const chunk = scene.getObjectByName(`land ${cell.x},${cell.z}`)!;
    const expected = world.treesInArea(cell.x * CHUNK_SIZE, cell.z * CHUNK_SIZE, CHUNK_SIZE, 29);
    const placed = pooled(scene, 'near tree trunks', chunk).map((position) => [position.x, position.z]).sort((a, b) => a[0]! - b[0]!);
    // Only the anchor-relative offset is rounded to float32, so far trees keep sub-millimetre placement.
    expect(placed).toEqual(expected.sort((a, b) => a.x - b.x).map((tree) => [
      Math.fround(tree.x - pool.position.x) + pool.position.x,
      Math.fround(tree.z - pool.position.z) + pool.position.z,
    ]));
    const usage = terrain.poolUsage;
    expect(usage['near tree trunks']!.used).toBeGreaterThan(0);
    for (const entry of Object.values(usage)) expect(entry.grown).toBe(0);
    terrain.clear();
    for (const entry of Object.values(terrain.poolUsage)) expect(entry.used).toBe(0);
    expect((pool as THREE.InstancedMesh).count).toBe(0);
    terrain.dispose();
  });

  it('matches terrain and sea-level water across a chunk seam built by separate streams', () => {
    const seam = 10 * CHUNK_SIZE;
    const probe = new WorldModel(448122);
    const chunkZ = Array.from({ length: 21 }, (_, i) => i - 10)
      .find((z) => Array.from({ length: 41 }, (_, i) => probe.sample(seam, (z + i / 40) * CHUNK_SIZE).water).some(Boolean))!;
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

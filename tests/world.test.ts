import { describe, expect, it } from 'vitest';
import { seedFromText, WorldModel } from '../src/world';

// Existing generic contracts retained. River/drainage contracts were retired;
// their replacement geography and placement evidence is continental.smoke.ts.
describe('deterministic world generation', () => {
  it.each([0, 4294967295])('keeps unsigned edge seed %i deterministic across world data', (seed) => {
    const first = new WorldModel(seed),
      second = new WorldModel(seed);
    expect(first.seed).toBe(seed);
    const point = first.sample(-12_503.4, 9_921.7);
    expect(point).toEqual(second.sample(-12_503.4, 9_921.7));
    expect(Number.isFinite(point.height)).toBe(true);
    expect(first.thermalAtCell(-2, 7)).toEqual(second.thermalAtCell(-2, 7));
  });
  it('returns identical terrain and thermals for a seed', () => {
    const first = new WorldModel(seedFromText('highland-river')),
      second = new WorldModel(seedFromText('highland-river'));
    for (const [x, z] of [
      [0, 0],
      [359.99, -720],
      [12503.4, 9921.7],
      [-880, 440],
    ]) {
      expect(first.sample(x!, z!)).toEqual(second.sample(x!, z!));
    }
    expect(first.thermalAtCell(-2, 7)).toEqual(second.thermalAtCell(-2, 7));
  });
  it('recomputes identical world data after all cached entries are evicted', () => {
    const world = new WorldModel(seedFromText('cache-eviction'));
    const points = [
      [0, 0],
      [359.99, -720],
      [12503.4, 9921.7],
      [-880, 440],
    ];
    const terrain = points.map(([x, z]) => world.sample(x!, z!)),
      thermal = world.thermalAtCell(-2, 7);
    expect(world.trim(0)).toEqual({ thermals: 0 });
    expect(points.map(([x, z]) => world.sample(x!, z!))).toEqual(terrain);
    expect(world.thermalAtCell(-2, 7)).toEqual(thermal);
  });
  it('generates the same tree positions and forms after a chunk is rebuilt', () => {
    const first = new WorldModel(80231),
      second = new WorldModel(80231);
    // The 7 km continental field floods the old chunk at (-6, -10); this one is forested.
    const trees = first.treesInArea(-9 * 360, -4 * 360, 360, 36);
    expect(trees.length).toBeGreaterThan(0);
    expect(trees).toEqual(second.treesInArea(-9 * 360, -4 * 360, 360, 36));
    expect(trees).not.toEqual(new WorldModel(80232).treesInArea(-9 * 360, -4 * 360, 360, 36));
    expect(new Set(trees.map((tree) => tree.kind)).size).toBeGreaterThan(1);
  });
  it('keeps tree positions identical across chunk partitions, including negative boundaries', () => {
    const world = new WorldModel(80231);
    let originX = -8 * 360,
      originZ = -6 * 360;
    for (let z = -10; z <= -1; z++)
      for (let x = -10; x <= -1; x++) {
        if (world.treesInArea(x * 360, z * 360, 720, 36).length < 50) continue;
        originX = x * 360;
        originZ = z * 360;
      }
    const whole = world.treesInArea(originX, originZ, 720, 36);
    const streamed = [
      world.treesInArea(originX, originZ, 360, 36),
      world.treesInArea(originX + 360, originZ, 360, 36),
      world.treesInArea(originX, originZ + 360, 360, 36),
      world.treesInArea(originX + 360, originZ + 360, 360, 36),
    ].flat();
    const byPosition = (a: { x: number; z: number }, b: { x: number; z: number }) => a.x - b.x || a.z - b.z;
    expect(streamed.length).toBeGreaterThan(40);
    expect(streamed.sort(byPosition)).toEqual(whole.sort(byPosition));
    const seam = originX + 360;
    expect(streamed.filter((tree) => tree.x >= seam - 90 && tree.x < seam).length).toBeGreaterThan(0);
    expect(streamed.filter((tree) => tree.x >= seam && tree.x < seam + 90).length).toBeGreaterThan(0);
  });
  it('makes large forests, open meadows, small groves and isolated trees', () => {
    // A wooded window on the 7 km continental field: 20 cells west, 25 south.
    const world = new WorldModel(80231),
      westX = -20,
      southZ = -25;
    const counts: Array<{ x: number; z: number; n: number }> = [];
    for (let z = -12; z <= 12; z++)
      for (let x = -12; x <= 12; x++)
        counts.push({ x, z, n: world.treesInArea((x + westX) * 360, (z + southZ) * 360, 360, 36).length });
    const at = (x: number, z: number) => counts.find((cell) => cell.x === x && cell.z === z)?.n ?? 0;
    const interior = counts.filter((cell) => Math.abs(cell.x) < 12 && Math.abs(cell.z) < 12),
      forests = counts.filter((cell) => cell.n > 40);
    expect(forests.length).toBeGreaterThan(6);
    expect(forests.some((cell) => at(cell.x + 1, cell.z) > 40 || at(cell.x, cell.z + 1) > 40)).toBe(true);
    expect(interior.some((cell) => cell.n === 0 && at(cell.x + 1, cell.z) === 0)).toBe(true);
    expect(
      interior.some(
        (cell) =>
          cell.n >= 8 &&
          cell.n <= 24 &&
          [-1, 0, 1].every((dz) =>
            [-1, 0, 1].every((dx) => (dx === 0 && dz === 0) || at(cell.x + dx, cell.z + dz) < 8),
          ),
      ),
    ).toBe(true);
    expect(
      interior.some(
        (cell) =>
          cell.n === 1 &&
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dz]) => at(cell.x + dx!, cell.z + dz!) === 0),
      ),
    ).toBe(true);
  });
  it('does not quantize heights at chunk-size boundaries', () => {
    const world = new WorldModel(80231);
    expect(Math.abs(world.sample(359.999, 127.25).height - world.sample(360.001, 127.25).height)).toBeLessThan(0.02);
  });
  it('changes the generated landscape for another seed', () => {
    const first = new WorldModel(1001),
      second = new WorldModel(1002);
    expect(first.sample(481, -219).height).not.toBe(second.sample(481, -219).height);
    expect(first.thermalAtCell(2, 0)).not.toEqual(second.thermalAtCell(2, 0));
  });
  it('places thermals deterministically and never on water', () => {
    const first = new WorldModel(448122),
      second = new WorldModel(448122),
      placed: Array<{ x: number; z: number }> = [];
    // Thermals sit only on land, so the window lies 16 cells west, where land is common.
    for (let z = -8; z <= 8; z++)
      for (let x = -24; x <= -8; x++) {
        const thermal = first.thermalAtCell(x, z);
        expect(thermal).toEqual(second.thermalAtCell(x, z));
        if (!thermal) continue;
        expect(first.sample(thermal.x, thermal.z).water).toBe(false);
        placed.push(thermal);
      }
    expect(placed.length).toBeGreaterThan(200);
    expect(first.nearbyThermals(0, 0, 2)).toEqual(second.nearbyThermals(0, 0, 2));
    expect(new WorldModel(448123).thermalAtCell(2, 3)).not.toEqual(first.thermalAtCell(2, 3));
  });
  it('starts visits at more interesting terrain than unscored ring points', () => {
    const world = new WorldModel(448122);
    let chosen = 0,
      unscored = 0;
    for (let visit = 1; visit <= 24; visit++) {
      const radius = (3 + (visit % 9)) * 920 + 350,
        angle = visit * 2.399,
        x = Math.cos(angle) * radius,
        z = Math.sin(angle) * radius;
      // Starts are always on land, so compare them with land ring points only. Open sea scores
      // a shore bonus, and the 7 km continental field puts many ring points there.
      if (world.sample(x, z).water) continue;
      const start = world.scenicStart(visit);
      chosen += world.interest(start.x, start.z);
      unscored += world.interest(x, z);
    }
    expect(chosen).toBeGreaterThan(unscored * 1.3);
  });
});

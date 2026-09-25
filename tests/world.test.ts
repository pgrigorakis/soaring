import { describe, expect, it } from 'vitest';
import { meanderOffset, seedFromText, WorldModel } from '../src/world';

describe('deterministic world generation', () => {
  it('returns identical terrain and thermals for a seed', () => {
    const first = new WorldModel(seedFromText('highland-river'));
    const second = new WorldModel(seedFromText('highland-river'));
    const points = [[0, 0], [359.99, -720], [12503.4, 9921.7], [-880, 440]];
    for (const [x, z] of points) {
      expect(first.sample(x!, z!)).toEqual(second.sample(x!, z!));
    }
    expect(first.thermalAtCell(-2, 7)).toEqual(second.thermalAtCell(-2, 7));
  });

  it('generates the same tree positions and forms after a chunk is rebuilt', () => {
    const first = new WorldModel(80231);
    const second = new WorldModel(80231);
    const trees = first.treesInArea(-1440, -360, 360, 36);
    expect(trees.length).toBeGreaterThan(0);
    expect(trees).toEqual(second.treesInArea(-1440, -360, 360, 36));
    expect(trees).not.toEqual(new WorldModel(80232).treesInArea(-1440, -360, 360, 36));
    expect(new Set(trees.map((tree) => tree.kind)).size).toBeGreaterThan(1);
  });

  it('keeps tree positions identical across chunk partitions, including negative boundaries', () => {
    const world = new WorldModel(80231);
    const whole = world.treesInArea(-1440, -720, 720, 36);
    const streamed = [
      world.treesInArea(-1440, -720, 360, 36),
      world.treesInArea(-1080, -720, 360, 36),
      world.treesInArea(-1440, -360, 360, 36),
      world.treesInArea(-1080, -360, 360, 36),
    ].flat();
    const byPosition = (a: { x: number; z: number }, b: { x: number; z: number }) => a.x - b.x || a.z - b.z;
    expect(streamed.length).toBeGreaterThan(100);
    expect(streamed.sort(byPosition)).toEqual(whole.sort(byPosition));
    const nearLeft = streamed.filter((tree) => tree.x >= -1170 && tree.x < -1080).length;
    const nearRight = streamed.filter((tree) => tree.x >= -1080 && tree.x < -990).length;
    expect(nearLeft).toBeGreaterThan(5);
    expect(nearRight).toBeGreaterThan(5);
  });

  it('makes large forests, open meadows, small groves and isolated trees', () => {
    const world = new WorldModel(80231);
    const count = (x: number, z: number) => world.treesInArea(x * 360, z * 360, 360, 36).length;
    expect(count(-5, 0)).toBeGreaterThan(50);
    expect(count(-4, 0)).toBeGreaterThan(50); // forest spans chunks
    expect(count(0, -3)).toBe(0);
    expect(count(1, -3)).toBe(0); // broad meadow
    expect(count(-3, -5)).toBeGreaterThan(8); // a smaller grove
    expect(count(-4, -5)).toBeLessThan(5);
    expect(count(-2, -5)).toBeLessThan(5); // surrounded by open ground
    expect(count(1, 2)).toBe(1); // rare lone tree in open country
    expect(count(0, 2)).toBe(0);
    expect(count(2, 2)).toBe(0);
  });

  it('does not quantize heights at chunk-size boundaries', () => {
    const world = new WorldModel(80231);
    const left = world.sample(359.999, 127.25).height;
    const right = world.sample(360.001, 127.25).height;
    expect(Math.abs(left - right)).toBeLessThan(0.02);
  });

  it('changes the generated landscape for another seed', () => {
    const first = new WorldModel(1001);
    const second = new WorldModel(1002);
    expect(first.sample(481, -219).height).not.toBe(second.sample(481, -219).height);
    expect(first.thermalAtCell(2, 3)).not.toEqual(second.thermalAtCell(2, 3));
  });

  it('places thermals deterministically and never on water', () => {
    const first = new WorldModel(448122);
    const second = new WorldModel(448122);
    const placed: Array<{ x: number; z: number }> = [];
    for (let cellZ = -8; cellZ <= 8; cellZ += 1) {
      for (let cellX = -8; cellX <= 8; cellX += 1) {
        const thermal = first.thermalAtCell(cellX, cellZ);
        expect(thermal).toEqual(second.thermalAtCell(cellX, cellZ));
        if (!thermal) continue;
        expect(first.sample(thermal.x, thermal.z).water).toBe(false);
        placed.push(thermal);
      }
    }
    expect(placed.length).toBeGreaterThan(200);
    expect(first.nearbyThermals(0, 0, 2)).toEqual(second.nearbyThermals(0, 0, 2));
    expect(new WorldModel(448123).thermalAtCell(2, 3)).not.toEqual(first.thermalAtCell(2, 3));
  });

  it('carves river valleys without near-vertical walls', () => {
    const world = new WorldModel(448122);
    const reaches = world.reachesIn(-8000, -8000, 8000, 8000).filter((reach) => reach.ax !== reach.bx || reach.az !== reach.bz);
    expect(reaches.length).toBeGreaterThan(200);
    let steepest = 0;
    for (const reach of reaches.slice(0, 200)) {
      const length = Math.hypot(reach.bx - reach.ax, reach.bz - reach.az);
      const [nx, nz] = [(reach.bz - reach.az) / length, -(reach.bx - reach.ax) / length];
      const [cx, cz] = [(reach.ax + reach.bx) / 2, (reach.az + reach.bz) / 2];
      let previous = world.sample(cx - nx * 200, cz - nz * 200).height;
      for (let d = -198; d <= 200; d += 2) {
        const height = world.sample(cx + nx * d, cz + nz * d).height;
        steepest = Math.max(steepest, Math.abs(height - previous) / 2);
        previous = height;
      }
    }
    expect(steepest).toBeLessThan(3);
  });

  it('routes rivers downhill into larger rivers, widening downstream, without crossings', () => {
    const world = new WorldModel(448122);
    const reaches = world.reachesIn(-10_000, -10_000, 10_000, 10_000);
    const starting = new Map(reaches.map((reach) => [`${reach.ax},${reach.az}`, reach]));
    let confluences = 0;
    const inflows = new Map<string, number>();
    for (const reach of reaches) {
      expect(reach.bLevel).toBeLessThanOrEqual(reach.aLevel);
      const next = starting.get(`${reach.bx},${reach.bz}`);
      if (reach.ax === reach.bx && reach.az === reach.bz) continue; // ends in a lake
      if (!next) continue; // leaves the tested area
      expect(next.aLevel).toBe(reach.bLevel);
      expect(next.aWidth).toBeGreaterThanOrEqual(reach.aWidth);
      const key = `${reach.bx},${reach.bz}`;
      inflows.set(key, (inflows.get(key) ?? 0) + 1);
    }
    for (const count of inflows.values()) if (count > 1) confluences += 1;
    expect(confluences).toBeGreaterThan(50);
    const widths = reaches.filter((reach) => reach.ax !== reach.bx || reach.az !== reach.bz).map((reach) => reach.aWidth);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(6);
    expect(Math.min(...widths)).toBeLessThanOrEqual(8);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(30);
    expect(Math.max(...widths)).toBeLessThanOrEqual(40);

    // Each reach is drawn as a meandering polyline; no two may touch except where one flows into the other.
    type Line = { points: Array<[number, number]>; start: string; end: string };
    const lines: Line[] = reaches.filter((reach) => reach.ax !== reach.bx || reach.az !== reach.bz).map((reach) => {
      const length = Math.hypot(reach.bx - reach.ax, reach.bz - reach.az);
      const points = Array.from({ length: 17 }, (_, k): [number, number] => {
        const t = k / 16;
        if (k === 0 || k === 16) return k === 0 ? [reach.ax, reach.az] : [reach.bx, reach.bz]; // exact shared ends
        const offset = meanderOffset(reach, t);
        return [
          reach.ax + (reach.bx - reach.ax) * t + offset * (reach.bz - reach.az) / length,
          reach.az + (reach.bz - reach.az) * t - offset * (reach.bx - reach.ax) / length,
        ];
      });
      return { points, start: `${reach.ax},${reach.az}`, end: `${reach.bx},${reach.bz}` };
    });
    const crosses = ([ax, az]: number[], [bx, bz]: number[], [cx, cz]: number[], [dx, dz]: number[]) => {
      const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
      return side(ax!, az!, bx!, bz!, cx!, cz!) * side(ax!, az!, bx!, bz!, dx!, dz!) < 0
        && side(cx!, cz!, dx!, dz!, ax!, az!) * side(cx!, cz!, dx!, dz!, bx!, bz!) < 0;
    };
    let checked = 0;
    for (let i = 0; i < lines.length; i += 1) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const [a, b] = [lines[i]!, lines[j]!];
        if (Math.hypot(a.points[0]![0] - b.points[0]![0], a.points[0]![1] - b.points[0]![1]) > 700) continue;
        checked += 1;
        for (let p = 0; p < 16; p += 1) {
          for (let q = 0; q < 16; q += 1) {
            if (crosses(a.points[p]!, a.points[p + 1]!, b.points[q]!, b.points[q + 1]!)) {
              throw new Error(`rivers cross: ${a.start}->${a.end} and ${b.start}->${b.end}`);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('marks river water at its reach and keeps trees off steep slopes', () => {
    const world = new WorldModel(448122);
    const reach = world.reachesIn(0, 0, 4000, 4000).find((candidate) => candidate.ax !== candidate.bx)!;
    const middle = world.sample((reach.ax + reach.bx) / 2, (reach.az + reach.bz) / 2 + 0);
    expect(middle.surface).toBeCloseTo((reach.aLevel + reach.bLevel) / 2, 0);
    const trees = world.treesInArea(-3000, -3000, 6000, 29);
    expect(trees.length).toBeGreaterThan(1000);
    for (const tree of trees) {
      const slope = Math.hypot(world.sample(tree.x + 3, tree.z).height - tree.y, world.sample(tree.x, tree.z + 3).height - tree.y) / 3;
      expect(slope).toBeLessThanOrEqual(0.6);
    }
  });

  it('never leaves dry ground under the water drawn at a river or lake edge', () => {
    // Mirrors the 9 m terrain grid: water covers every quad with a wet corner, and dry corners take
    // their wet neighbors' level. Ground beside that water must stay above it, or the edge shows steps.
    const world = new WorldModel(448122);
    const step = 9;
    const size = 400;
    const grid = Array.from({ length: (size + 1) ** 2 }, (_, index) =>
      world.sample(-3400 + (index % (size + 1)) * step, -3000 + Math.floor(index / (size + 1)) * step));
    const at = (i: number, j: number) => grid[j * (size + 1) + i]!;
    let drawnEdges = 0;
    for (let j = 1; j < size; j += 1) {
      for (let i = 1; i < size; i += 1) {
        if (at(i, j).water) continue;
        const wet = [-1, 0, 1].flatMap((dj) => [-1, 0, 1].map((di) => at(i + di, j + dj))).filter((sample) => sample.water);
        if (wet.length === 0) continue;
        drawnEdges += 1;
        const level = wet.reduce((sum, sample) => sum + sample.surface, 0) / wet.length;
        expect(at(i, j).height).toBeGreaterThan(level - 0.3);
      }
    }
    expect(drawnEdges).toBeGreaterThan(1000);
  });

  it('gives identical river terrain whatever order chunks are generated in', () => {
    const points: Array<[number, number]> = [];
    // A seam line through river country, sampled at chunk-edge vertex spacing.
    for (let z = -3600; z <= 3600; z += 9) points.push([3600, z]);
    const forward = new WorldModel(448122);
    const backward = new WorldModel(448122);
    backward.sample(40_000, -40_000); // warm caches elsewhere first
    const a = points.map(([x, z]) => forward.sample(x, z));
    const b = [...points].reverse().map(([x, z]) => backward.sample(x, z)).reverse();
    expect(a).toEqual(b);
    expect(a.some((sample) => sample.river)).toBe(true);
  });

  it('starts visits at more interesting terrain than unscored ring points', () => {
    const world = new WorldModel(448122);
    let chosen = 0;
    let unscored = 0;
    for (let visit = 1; visit <= 24; visit += 1) {
      const start = world.scenicStart(visit);
      chosen += world.interest(start.x, start.z);
      const radius = (3 + (visit % 9)) * 920 + 350;
      const angle = visit * 2.399;
      unscored += world.interest(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    expect(chosen).toBeGreaterThan(unscored * 1.3);
  });
});

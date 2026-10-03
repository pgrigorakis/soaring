import { describe, expect, it } from 'vitest';
import { DRAINAGE_SPACING, meanderOffset, MIN_RIVER_HALF_WIDTH, seedFromText, WorldModel, type Reach } from '../src/world';

function channelPoint(reach: Reach, t: number): { x: number; z: number } {
  const length = Math.hypot(reach.bx - reach.ax, reach.bz - reach.az) || 1;
  const offset = meanderOffset(reach, t);
  return {
    x: reach.ax + (reach.bx - reach.ax) * t + offset * (reach.bz - reach.az) / length,
    z: reach.az + (reach.bz - reach.az) * t - offset * (reach.bx - reach.ax) / length,
  };
}

describe('deterministic world generation', () => {
  it.each([0, 4294967295])('keeps unsigned edge seed %i deterministic across world data', (seed) => {
    const first = new WorldModel(seed);
    const second = new WorldModel(seed);
    expect(first.seed).toBe(seed);
    const point = first.sample(-12_503.4, 9_921.7);
    expect(point).toEqual(second.sample(-12_503.4, 9_921.7));
    expect(Number.isFinite(point.height)).toBe(true);
    expect(first.thermalAtCell(-2, 7)).toEqual(second.thermalAtCell(-2, 7));
    expect(first.reachesNear(900, -1400)).toEqual(second.reachesNear(900, -1400));
  });

  it('returns identical terrain and thermals for a seed', () => {
    const first = new WorldModel(seedFromText('highland-river'));
    const second = new WorldModel(seedFromText('highland-river'));
    const points = [[0, 0], [359.99, -720], [12503.4, 9921.7], [-880, 440]];
    for (const [x, z] of points) {
      expect(first.sample(x!, z!)).toEqual(second.sample(x!, z!));
    }
    expect(first.thermalAtCell(-2, 7)).toEqual(second.thermalAtCell(-2, 7));
  });

  it('recomputes identical world data after all cached entries are evicted', () => {
    const world = new WorldModel(seedFromText('cache-eviction'));
    const points = [[0, 0], [359.99, -720], [12503.4, 9921.7], [-880, 440]];
    const terrain = points.map(([x, z]) => world.sample(x!, z!));
    const thermal = world.thermalAtCell(-2, 7);
    const reaches = world.reachesNear(900, -1400);

    expect(world.trim(0)).toEqual({ thermals: 0, riverNodes: 0, nearbyReaches: 0 });
    expect(points.map(([x, z]) => world.sample(x!, z!))).toEqual(terrain);
    expect(world.thermalAtCell(-2, 7)).toEqual(thermal);
    expect(world.reachesNear(900, -1400)).toEqual(reaches);
  });

  it('generates the same tree positions and forms after a chunk is rebuilt', () => {
    const first = new WorldModel(80231);
    const second = new WorldModel(80231);
    const trees = first.treesInArea(-9 * 360, 9 * 360, 360, 36);
    expect(trees.length).toBeGreaterThan(0);
    expect(trees).toEqual(second.treesInArea(-9 * 360, 9 * 360, 360, 36));
    expect(trees).not.toEqual(new WorldModel(80232).treesInArea(-9 * 360, 9 * 360, 360, 36));
    expect(new Set(trees.map((tree) => tree.kind)).size).toBeGreaterThan(1);
  });

  it('keeps tree positions identical across chunk partitions, including negative boundaries', () => {
    const world = new WorldModel(80231);
    let originX = -8 * 360;
    let originZ = -6 * 360;
    for (let z = -10; z <= -1; z += 1) {
      for (let x = -10; x <= -1; x += 1) {
        if (world.treesInArea(x * 360, z * 360, 720, 36).length < 50) continue;
        originX = x * 360;
        originZ = z * 360;
      }
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
    const world = new WorldModel(80231);
    const counts: Array<{ x: number; z: number; n: number }> = [];
    for (let z = -12; z <= 12; z += 1) {
      for (let x = -12; x <= 12; x += 1) counts.push({ x, z, n: world.treesInArea(x * 360, z * 360, 360, 36).length });
    }
    const at = (x: number, z: number) => counts.find((cell) => cell.x === x && cell.z === z)?.n ?? 0;
    const interior = counts.filter((cell) => Math.abs(cell.x) < 12 && Math.abs(cell.z) < 12);
    const forests = counts.filter((cell) => cell.n > 40);
    expect(forests.length).toBeGreaterThan(6);
    expect(forests.some((cell) => at(cell.x + 1, cell.z) > 40 || at(cell.x, cell.z + 1) > 40)).toBe(true);
    expect(interior.some((cell) => cell.n === 0 && at(cell.x + 1, cell.z) === 0)).toBe(true);
    expect(interior.some((cell) => cell.n >= 8 && cell.n <= 24
      && [-1, 0, 1].every((dz) => [-1, 0, 1].every((dx) => dx === 0 && dz === 0 || at(cell.x + dx, cell.z + dz) < 8)))).toBe(true);
    expect(interior.some((cell) => cell.n === 1
      && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => at(cell.x + dx!, cell.z + dz!) === 0))).toBe(true);
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
    const reaches = world.reachesIn(-10000, -10000, 10000, 10000).filter((reach) => reach.ax !== reach.bx || reach.az !== reach.bz);
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
    expect(confluences).toBeGreaterThan(15);
    const widths = reaches.filter((reach) => reach.ax !== reach.bx || reach.az !== reach.bz).map((reach) => reach.aWidth);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(MIN_RIVER_HALF_WIDTH * 2);
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths));

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
    expect(checked).toBeGreaterThan(100);
  });

  it('marks river water at its reach and keeps trees off steep slopes', () => {
    const world = new WorldModel(448122);
    const reach = world.reachesIn(0, 0, 4000, 4000).find((candidate) => candidate.ax !== candidate.bx)!;
    const middle = channelPoint(reach, 0.5);
    const sample = world.sample(middle.x, middle.z);
    expect(sample.water).toBe(true);
    expect(sample.surface).toBeCloseTo((reach.aLevel + reach.bLevel) / 2, 0);
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

  it('drains each lattice node downhill, merges tributaries, and ends in a lake or outside the window', () => {
    const world = new WorldModel(448122);
    const radius = 14;
    const nodes: Array<ReturnType<WorldModel['drainageAt']>> = [];
    for (let j = -radius; j <= radius; j += 1) {
      for (let i = -radius; i <= radius; i += 1) nodes.push(world.drainageAt(i, j));
    }
    const at = (i: number, j: number) => nodes.find((node) => node.i === i && node.j === j);
    let merges = 0;
    let lakes = 0;
    const inflows = new Map<string, number>();
    for (const node of nodes) {
      if (node.downstreamI === null || node.downstreamJ === null) {
        if (node.lake) lakes += 1;
        continue;
      }
      const down = at(node.downstreamI, node.downstreamJ);
      if (!down) continue;
      expect(down.elevation).toBeLessThan(node.elevation);
      expect(down.level).toBeLessThan(node.level);
      expect(down.flow).toBeGreaterThanOrEqual(node.flow);
      const key = `${down.i},${down.j}`;
      inflows.set(key, (inflows.get(key) ?? 0) + 1);
    }
    for (const count of inflows.values()) if (count > 1) merges += 1;
    expect(merges).toBeGreaterThan(8);
    expect(lakes).toBeGreaterThan(2);

    let endedInLake = 0;
    let leftWindow = 0;
    for (const start of nodes.filter((node) => node.flow >= 4 && node.downstreamI !== null)) {
      let node = start;
      const seen = new Set<string>();
      for (let step = 0; step < 80; step += 1) {
        const key = `${node.i},${node.j}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        if (node.downstreamI === null || node.downstreamJ === null) {
          expect(node.lake).toBe(true);
          endedInLake += 1;
          break;
        }
        const down = at(node.downstreamI, node.downstreamJ);
        if (!down) {
          leftWindow += 1;
          break;
        }
        expect(down.level).toBeLessThan(node.level);
        node = down;
      }
    }
    expect(endedInLake).toBeGreaterThan(0);
    expect(leftWindow + endedInLake).toBeGreaterThan(20);
  });

  it('builds the same drainage lattice from either side of a tile boundary', () => {
    const forward = new WorldModel(448122);
    const backward = new WorldModel(448122);
    const seam = 8; // index just beside a 360 m chunk edge is not required; the lattice itself must match
    const nodes = [];
    for (let j = -3; j <= 3; j += 1) {
      for (let i = seam - 3; i <= seam + 3; i += 1) nodes.push([i, j] as const);
    }
    backward.drainageAt(40, -40);
    const a = nodes.map(([i, j]) => forward.drainageAt(i, j));
    const b = [...nodes].reverse().map(([i, j]) => backward.drainageAt(i, j)).reverse();
    expect(a).toEqual(b);
    expect(a.some((node) => node.flow > 1)).toBe(true);
    const edge = 4 * 360;
    for (let z = -720; z <= 720; z += 90) {
      expect(forward.sample(edge, z)).toEqual(backward.sample(edge, z));
    }
    expect(DRAINAGE_SPACING).toBe(500);
  });

  it('keeps river water and valley floors visible on the far terrain grid', () => {
    const world = new WorldModel(448122);
    const step = (360 * 4) / 16;
    expect(step).toBe(90);
    expect(MIN_RIVER_HALF_WIDTH).toBeGreaterThan(step / Math.SQRT2);
    const rivers = world.reachesIn(-6000, -6000, 6000, 6000).filter((reach) => !reach.lake);
    expect(rivers.length).toBeGreaterThan(20);
    let valleys = 0;
    let banks = 0;
    let exposedRivers = 0;
    for (const reach of rivers) {
      const middle = channelPoint(reach, 0.5);
      const sx = Math.round(middle.x / step) * step;
      const sz = Math.round(middle.z / step) * step;
      expect(world.sample(sx, sz).water || world.sample(middle.x, middle.z).water).toBe(true);
      const length = Math.hypot(reach.bx - reach.ax, reach.bz - reach.az) || 1;
      const nx = (reach.bz - reach.az) / length;
      const nz = -(reach.bx - reach.ax) / length;
      const center = world.sample(middle.x, middle.z);
      // Lake-covered tributaries have lake shores, not banks at river half-width.
      if (!center.river) continue;
      const left = world.sample(middle.x + nx * 260, middle.z + nz * 260);
      const right = world.sample(middle.x - nx * 260, middle.z - nz * 260);
      if ((left.water && !left.river) || (right.water && !right.river)) continue;
      exposedRivers += 1;
      expect(center.water).toBe(true);
      expect(center.height).toBeLessThan(center.surface);
      const half = (reach.aWidth + reach.bWidth) / 4;
      const shore = [1, -1].map((sign) => {
        for (let extra = 12; extra <= 140; extra += 8) {
          const sample = world.sample(middle.x + nx * sign * (half + extra), middle.z + nz * sign * (half + extra));
          if (!sample.water) return sample;
        }
        return null;
      }).find((sample) => sample && sample.height > center.surface - 0.2);
      if (shore) banks += 1;
      if (left.height > center.height + 3 && right.height > center.height + 3) valleys += 1;
    }
    expect(exposedRivers).toBeGreaterThan(20);
    expect(banks).toBeGreaterThan(exposedRivers * 0.75);
    expect(valleys).toBeGreaterThan(exposedRivers * 0.6);
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

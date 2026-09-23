import { describe, expect, it } from 'vitest';
import { seedFromText, WorldModel } from '../src/world';

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

  it('carves river valleys without near-vertical walls', () => {
    const world = new WorldModel(448122);
    let steepest = 0;
    for (let z = -20_000; z <= 20_000; z += 250) {
      let previous = world.sample(2300, z).height;
      for (let x = 2302; x <= 3900; x += 2) {
        const height = world.sample(x, z).height;
        steepest = Math.max(steepest, Math.abs(height - previous) / 2);
        previous = height;
      }
    }
    expect(steepest).toBeLessThan(3);
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

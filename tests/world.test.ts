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
});

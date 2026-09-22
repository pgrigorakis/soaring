import { describe, expect, it } from 'vitest';
import { EagleNavigator } from '../src/eagle';
import { WorldModel } from '../src/world';

describe('autonomous eagle navigation', () => {
  it('keeps safe terrain clearance during accelerated long flight', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    const start = { x: navigator.state.x, z: navigator.state.z };
    const behaviors = new Set<string>();
    let minimumClearance = Infinity;
    for (let step = 0; step < 36_000; step += 1) {
      const state = navigator.update(0.1);
      behaviors.add(state.behavior);
      minimumClearance = Math.min(minimumClearance, state.y - world.sample(state.x, state.z).height);
    }
    expect(minimumClearance).toBeGreaterThan(25);
    expect(Math.hypot(navigator.state.x - start.x, navigator.state.z - start.z)).toBeGreaterThan(700);
    expect(behaviors.has('seeking thermal')).toBe(true);
    expect(behaviors.has('circling thermal')).toBe(true);
    expect(behaviors.size).toBeGreaterThanOrEqual(3);
  });
});

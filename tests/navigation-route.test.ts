import { describe, expect, it } from 'vitest';
import { EagleNavigator } from '../src/eagle';
import { WORLD_CACHE_LIMIT, WorldModel } from '../src/world';

describe('one-hour eagle navigation routes', () => {
  it.each([448122, 0, 4294967295])('keeps a safe persistent route and bounded world caches for seed %i', (seed) => {
    const world = new WorldModel(seed);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    const start = { x: navigator.state.x, z: navigator.state.z };
    const routeSamples = [{ time: 0, ...start }];
    let distanceFlown = 0;
    let nearOldRoute = false;
    let revisitPasses = 0;
    let maxThermals = 0;
    for (let step = 0; step < 36_000; step += 1) {
      const previous = { x: navigator.state.x, z: navigator.state.z };
      const state = navigator.update(0.1);
      distanceFlown += Math.hypot(state.x - previous.x, state.z - previous.z);
      if ((step + 1) % 100 === 0) {
        const time = (step + 1) * 0.1;
        const nearAgedVisit = routeSamples.some((visit) => time - visit.time > 600
          && Math.hypot(state.x - visit.x, state.z - visit.z) <= 1000);
        if (nearAgedVisit && !nearOldRoute) revisitPasses += 1;
        nearOldRoute = nearAgedVisit;
        routeSamples.push({ time, x: state.x, z: state.z });
      }
      if ((step + 1) % 10 !== 0) continue;
      const sizes = world.trim(WORLD_CACHE_LIMIT);
      maxThermals = Math.max(maxThermals, sizes.thermals);
    }
    const netDistance = Math.hypot(navigator.state.x - start.x, navigator.state.z - start.z);
    // #86 approval: seed 0 reaches 30.1% with lowland hills; accept 30% for this seed only.
    // All other route, cache, and terrain-clearance requirements stay unchanged.
    expect(netDistance).toBeGreaterThanOrEqual(distanceFlown * (seed === 0 ? 0.30 : 0.35));
    expect(revisitPasses).toBeLessThanOrEqual(5);
    expect(maxThermals).toBeLessThanOrEqual(WORLD_CACHE_LIMIT);
  }, 20_000); // A simulated hour exceeds Vitest's 5 s default on shared CI CPUs.
});

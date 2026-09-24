import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { EagleNavigator, EagleView, normalizeFlightHeight } from '../src/eagle';
import { WorldModel } from '../src/world';

describe('autonomous eagle navigation', () => {
  it('finishes a thermal approach through the visible navigation path', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    let closeApproaches = 0;
    let entries = 0;
    let closeRetargets = 0;
    let approachingSince: number | null = null;
    for (let step = 0; step < 12_000; step += 1) {
      const previous = navigator.activeThermal;
      const previousBehavior = navigator.state.behavior;
      const state = navigator.update(0.1);
      if (state.behavior === 'seeking thermal' && navigator.activeThermal) {
        const distance = Math.hypot(state.x - navigator.activeThermal.x, state.z - navigator.activeThermal.z);
        if (distance < 150) {
          closeApproaches += 1;
          approachingSince ??= step;
        }
        if (approachingSince !== null) expect(step - approachingSince).toBeLessThan(100);
      }
      if (previousBehavior === 'seeking thermal' && previous &&
        Math.hypot(state.x - previous.x, state.z - previous.z) < 150 &&
        state.behavior === 'seeking thermal' && navigator.activeThermal !== previous) closeRetargets += 1;
      if (state.behavior === 'circling thermal' && previousBehavior === 'seeking thermal') {
        entries += 1;
        approachingSince = null;
      }
      if (approachingSince !== null && state.behavior !== 'seeking thermal') {
        throw new Error('Thermal approach abandoned before circling');
      }
    }
    expect(closeApproaches).toBeGreaterThan(0);
    expect(entries).toBeGreaterThan(0);
    expect(closeRetargets).toBe(0);
  });

  it.each([{ min: 50, max: 70 }, { min: 90, max: 145 }, { min: 65, max: 210 }])(
    'keeps local clearance in $min–$max m bounds during a one-hour flight', (range) => {
      const world = new WorldModel(448122);
      const navigator = new EagleNavigator(world, world.scenicStart(2), range);
      const start = { x: navigator.state.x, z: navigator.state.z };
      const behaviors = new Set<string>();
      let minimumClearance = Infinity;
      let maximumClearance = -Infinity;
      let seekingTurns = 0;
      let circleEntries = 0;
      for (let step = 0; step < 36_000; step += 1) {
        const before = navigator.state.behavior;
        const heading = navigator.state.heading;
        const state = navigator.update(0.1);
        behaviors.add(state.behavior);
        const clearance = state.y - world.sample(state.x, state.z).height;
        minimumClearance = Math.min(minimumClearance, clearance);
        maximumClearance = Math.max(maximumClearance, clearance);
        if (state.behavior === 'seeking thermal' && Math.abs(state.heading - heading) > 0.001) seekingTurns += 1;
        if (state.behavior === 'circling thermal' && before === 'seeking thermal') circleEntries += 1;
      }
      expect(minimumClearance).toBeGreaterThanOrEqual(range.min - 0.001);
      expect(maximumClearance).toBeLessThanOrEqual(range.max + 0.001);
      expect(seekingTurns).toBeGreaterThan(10);
      expect(circleEntries).toBeGreaterThan(0);
      expect(Math.hypot(navigator.state.x - start.x, navigator.state.z - start.z)).toBeGreaterThan(700);
      expect(behaviors.has('seeking thermal')).toBe(true);
      expect(behaviors.has('circling thermal')).toBe(true);
      expect(behaviors.size).toBeGreaterThanOrEqual(3);
    },
  );

  it('normalizes invalid and inverted flight height preferences to safe bounds', () => {
    expect(normalizeFlightHeight(Number.NaN, Infinity)).toEqual({ min: 65, max: 210 });
    expect(normalizeFlightHeight(230, 40)).toEqual({ min: 220, max: 240 });
  });

  it('flaps when seeking but glides while riding', () => {
    const view = new EagleView();
    const world = new WorldModel(448122);
    const state = new EagleNavigator(world, world.scenicStart(2)).state;
    const wing = view.group.children.find((child) => child instanceof Group && child.position.x < 0);
    expect(wing).toBeDefined();
    state.behavior = 'seeking thermal';
    view.update(state, 0.2);
    expect(Math.abs(wing!.rotation.z)).toBeGreaterThan(0.1);
    state.behavior = 'circling thermal';
    view.update(state, 0.2);
    expect(Math.abs(wing!.rotation.z)).toBeLessThan(0.03);
  });
});

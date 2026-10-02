import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLIGHT_HEIGHT, EagleNavigator, EagleView, GLIDE_SINK_RATE, normalizeFlightHeight,
  TERRAIN_SAFETY_MARGIN, THERMAL_BANK_RANGE, THERMAL_CLIMB_RANGE, THERMAL_RADIUS_RANGE,
} from '../src/eagle';
import { WORLD_CACHE_LIMIT, WorldModel } from '../src/world';

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
      if (state.behavior === 'thermal-seeking' && navigator.activeThermal) {
        const distance = Math.hypot(state.x - navigator.activeThermal.x, state.z - navigator.activeThermal.z);
        if (distance < 150) {
          closeApproaches += 1;
          approachingSince ??= step;
        }
        // Carved valleys can add a short detour on the last part of an approach.
        if (approachingSince !== null) expect(step - approachingSince).toBeLessThan(120);
      }
      if (previousBehavior === 'thermal-seeking' && previous &&
        Math.hypot(state.x - previous.x, state.z - previous.z) < 150 &&
        state.behavior === 'thermal-seeking' && navigator.activeThermal !== previous) closeRetargets += 1;
      if (state.behavior === 'thermal-riding' && previousBehavior === 'thermal-seeking') {
        entries += 1;
        approachingSince = null;
      }
      if (approachingSince !== null && state.behavior !== 'thermal-seeking') {
        throw new Error('Thermal approach abandoned before circling');
      }
    }
    expect(closeApproaches).toBeGreaterThan(0);
    expect(entries).toBeGreaterThan(0);
    expect(closeRetargets).toBe(0);
  });

  it('keeps a persistent route and bounded world caches during a one-hour navigation flight', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    const start = { x: navigator.state.x, z: navigator.state.z };
    const routeSamples = [{ time: 0, ...start }];
    let distanceFlown = 0;
    let nearOldRoute = false;
    let revisitPasses = 0;
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
      expect(sizes.thermals).toBeLessThanOrEqual(WORLD_CACHE_LIMIT);
      expect(sizes.riverNodes).toBeLessThanOrEqual(WORLD_CACHE_LIMIT);
      expect(sizes.nearbyReaches).toBeLessThanOrEqual(WORLD_CACHE_LIMIT);
    }
    const netDistance = Math.hypot(navigator.state.x - start.x, navigator.state.z - start.z);
    expect(netDistance).toBeGreaterThanOrEqual(distanceFlown * 0.35);
    expect(revisitPasses).toBeLessThanOrEqual(5);
  }, 20_000); // A simulated hour exceeds Vitest's 5 s default on shared CI CPUs.

  it.each([
    { min: 50, max: 70, baselineFlappingTicks: 6552 },
    { min: 90, max: 145, baselineFlappingTicks: 4449 },
    { min: 65, max: 210, baselineFlappingTicks: 1298 },
  ])(
    'never enters terrain and caps thermal climb against smoothed ground in $min–$max m during a one-hour flight', (range) => {
      const world = new WorldModel(448122);
      const navigator = new EagleNavigator(world, world.scenicStart(2), range);
      const start = { x: navigator.state.x, z: navigator.state.z };
      const behaviors = new Set<string>();
      let minimumClearance = Infinity;
      let seekingTurns = 0;
      let circleEntries = 0;
      let flappingTicks = 0;
      for (let step = 0; step < 36_000; step += 1) {
        const before = navigator.state.behavior;
        const previousY = navigator.state.y;
        const heading = navigator.state.heading;
        const state = navigator.update(0.1);
        behaviors.add(state.behavior);
        if (state.flapping) flappingTicks += 1;
        const clearance = state.y - world.sample(state.x, state.z).height;
        minimumClearance = Math.min(minimumClearance, clearance);
        if (state.behavior === 'thermal-seeking' && Math.abs(state.heading - heading) > 0.001) seekingTurns += 1;
        if (state.behavior === 'thermal-riding' && before === 'thermal-seeking') circleEntries += 1;
        // Cap climbing against the smoothed envelope, without teleporting down over a crest.
        if (state.behavior === 'thermal-riding') {
          expect(state.flapping).toBe(false);
          expect(state.y).toBeLessThanOrEqual(Math.max(previousY, navigator.flightGround + range.max) + 0.001);
        }
      }
      expect(minimumClearance).toBeGreaterThanOrEqual(TERRAIN_SAFETY_MARGIN - 0.001);
      expect(seekingTurns).toBeGreaterThan(10);
      expect(circleEntries).toBeGreaterThan(0);
      // Baselines are recorded from this seed on the original thermal grid.
      expect(flappingTicks).toBeLessThanOrEqual(range.baselineFlappingTicks * 1.25);
      expect(Math.hypot(navigator.state.x - start.x, navigator.state.z - start.z)).toBeGreaterThan(700);
      expect(behaviors.has('thermal-seeking')).toBe(true);
      expect(behaviors.has('thermal-riding')).toBe(true);
      expect(behaviors.size).toBe(3);
    },
    20_000,
  );

  it('normalizes invalid and inverted flight height preferences to safe bounds', () => {
    expect(normalizeFlightHeight(Number.NaN, Infinity)).toEqual({ min: 65, max: 210 });
    expect(normalizeFlightHeight(230, 40)).toEqual({ min: 220, max: 240 });
  });

  it('sinks while gliding, trading height for distance with no flapping', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    expect(navigator.state.behavior).toBe('gliding');
    navigator.state.y += 1000; // clear of the floor trigger regardless of local terrain
    const startY = navigator.state.y;
    for (let step = 0; step < 20; step += 1) {
      const state = navigator.update(0.1);
      expect(state.flapping).toBe(false);
    }
    expect(navigator.state.y).toBeCloseTo(startY - GLIDE_SINK_RATE * 2, 1);
  });

  it('flaps to climb when clearance nears the minimum flight height floor', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2), DEFAULT_FLIGHT_HEIGHT);
    const ground = world.sample(navigator.state.x, navigator.state.z).height;
    navigator.state.y = ground + DEFAULT_FLIGHT_HEIGHT.min + 5; // just under the soft floor trigger
    const before = navigator.state.y;
    const state = navigator.update(0.1);
    expect(state.flapping).toBe(true);
    expect(state.y).toBeGreaterThan(before);
  });

  it('never flaps while thermal-riding', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    navigator.state.behavior = 'thermal-riding';
    navigator.state.flapping = true;
    const state = navigator.update(0.1);
    expect(state.flapping).toBe(false);
  });

  it('wings flap only when the flapping wing state is set, independent of behavior', () => {
    const view = new EagleView();
    const world = new WorldModel(448122);
    const state = new EagleNavigator(world, world.scenicStart(2)).state;
    const wing = view.group.children.find((child) => child instanceof Group && child.position.x < 0);
    expect(wing).toBeDefined();
    state.flapping = true;
    view.update(state, 0.2);
    expect(Math.abs(wing!.rotation.z)).toBeGreaterThan(0.1);
    state.flapping = false;
    view.update(state, 0.2);
    expect(Math.abs(wing!.rotation.z)).toBeLessThan(0.03);
  });

  it('circles a thermal with varying radius and bank, climbing without flapping',
    () => {
      const world = new WorldModel(448122);
      const navigator = new EagleNavigator(world, world.scenicStart(2));
      let riding = false;
      const radii: number[] = [];
      const banks: number[] = [];
      let startY = 0;
      let elapsed = 0;
      let startThermalX = 0;
      let startThermalZ = 0;
      for (let step = 0; step < 36_000 && radii.length < 40; step += 1) {
        const before = navigator.state.behavior;
        const state = navigator.update(0.1);
        if (before !== 'thermal-riding' && state.behavior === 'thermal-riding' && navigator.activeThermal) {
          riding = true;
          const ground = world.sample(state.x, state.z).height;
          state.y = ground + DEFAULT_FLIGHT_HEIGHT.min + 40;
          startY = state.y;
          startThermalX = navigator.activeThermal.x;
          startThermalZ = navigator.activeThermal.z;
          elapsed = 0;
          radii.length = 0;
          banks.length = 0;
          continue;
        }
        if (riding && (state.behavior !== 'thermal-riding' || !navigator.activeThermal)) {
          riding = false;
          continue;
        }
        if (!riding || !navigator.activeThermal) continue;
        elapsed += 0.1;
        if (elapsed < 2) continue; // settle after entry
        expect(state.flapping).toBe(false);
        const radius = Math.hypot(state.x - navigator.activeThermal.x, state.z - navigator.activeThermal.z);
        radii.push(radius);
        banks.push(Math.abs(state.bank));
        expect(Math.abs(state.bank)).toBeGreaterThanOrEqual(THERMAL_BANK_RANGE.min - 0.02);
        expect(Math.abs(state.bank)).toBeLessThanOrEqual(THERMAL_BANK_RANGE.max + 0.02);
        expect(radius).toBeGreaterThan(THERMAL_RADIUS_RANGE.min - 12);
        expect(radius).toBeLessThan(THERMAL_RADIUS_RANGE.max + 12);
      }
      expect(radii.length).toBeGreaterThan(20);
      expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.4);
      expect(Math.max(...banks) - Math.min(...banks)).toBeGreaterThan(0.01);
      const climbRate = (navigator.state.y - startY) / elapsed;
      expect(climbRate).toBeGreaterThanOrEqual(THERMAL_CLIMB_RANGE.min * 0.4);
      expect(climbRate).toBeLessThanOrEqual(THERMAL_CLIMB_RANGE.max + 0.05);
      const thermal = navigator.activeThermal;
      expect(thermal).not.toBeNull();
      expect(Math.hypot(thermal!.x - startThermalX, thermal!.z - startThermalZ)).toBeGreaterThan(0.05);
    });

  it('keeps thermal-riding past 19 s when below maximum flight height', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    let riding = false;
    let held = 0;
    for (let step = 0; step < 36_000 && held < 20; step += 1) {
      const before = navigator.state.behavior;
      const state = navigator.update(0.1);
      if (before !== 'thermal-riding' && state.behavior === 'thermal-riding') {
        riding = true;
        const ground = world.sample(state.x, state.z).height;
        state.y = ground + DEFAULT_FLIGHT_HEIGHT.min + 20;
        held = 0;
        continue;
      }
      if (riding && state.behavior === 'thermal-riding') held += 0.1;
      else if (riding) break;
    }
    expect(held).toBeGreaterThan(19);
  });

  it('leaves thermal-riding at maximum flight height without a fixed timer', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    let exitedAtMax = false;
    for (let step = 0; step < 36_000; step += 1) {
      const before = navigator.state.behavior;
      const beforeY = navigator.state.y;
      const beforeX = navigator.state.x;
      const beforeZ = navigator.state.z;
      const state = navigator.update(0.1);
      if (before !== 'thermal-riding' || state.behavior === 'thermal-riding') continue;
      const ground = world.sample(beforeX, beforeZ).height;
      if (beforeY - ground >= DEFAULT_FLIGHT_HEIGHT.max - 0.05) {
        exitedAtMax = true;
        break;
      }
    }
    expect(exitedAtMax).toBe(true);
  });
});

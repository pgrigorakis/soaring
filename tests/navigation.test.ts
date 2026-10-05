import { describe, expect, it } from 'vitest';
import {
  CYCLE, EagleNavigator, EagleView, FLIGHT_HEIGHT, GLIDE_SINK_RATE,
  TERRAIN_SAFETY_MARGIN, THERMAL_BANK_RANGE, THERMAL_CLIMB_RANGE, THERMAL_RADIUS_RANGE,
} from '../src/eagle';
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

  it.each([FLIGHT_HEIGHT])(
    'never enters terrain and caps thermal climb at the cycle top within $min–$max m during a one-hour flight', (range) => {
      const world = new WorldModel(448122);
      const navigator = new EagleNavigator(world, world.scenicStart(2), range);
      const start = { x: navigator.state.x, z: navigator.state.z };
      const behaviors = new Set<string>();
      let minimumClearance = Infinity;
      let seekingTurns = 0;
      let circleEntries = 0;
      let dives = 0;
      let fastestDive = 0;
      for (let step = 0; step < 36_000; step += 1) {
        const before = navigator.state.behavior;
        const beforePhase = navigator.cycle.phase;
        const previousY = navigator.state.y;
        const heading = navigator.state.heading;
        const state = navigator.update(0.1);
        behaviors.add(state.behavior);
        if (beforePhase === 'lift' && navigator.cycle.phase === 'dive') dives += 1;
        if (beforePhase === 'dive' && navigator.cycle.phase === 'dive') fastestDive = Math.max(fastestDive, (previousY - state.y) / 0.1);
        const sample = world.sample(state.x, state.z);
        const clearance = state.y - sample.height;
        minimumClearance = Math.min(minimumClearance, clearance);
        if (state.behavior === 'thermal-seeking' && Math.abs(state.heading - heading) > 0.001) seekingTurns += 1;
        if (state.behavior === 'thermal-riding' && before === 'thermal-seeking') circleEntries += 1;
        // Cap climbing against the smoothed envelope, without teleporting down over a crest.
        if (state.behavior === 'thermal-riding' || state.behavior === 'ridge-soaring') {
          expect(state.flapping).toBe(false);
          expect(state.y).toBeLessThanOrEqual(Math.max(previousY, navigator.flightGround + range.max) + 0.001);
        }
        if (state.behavior === 'thermal-riding') expect(state.y).toBeLessThanOrEqual(Math.max(previousY, navigator.cycle.top) + 0.001);
      }
      expect(minimumClearance).toBeGreaterThanOrEqual(TERRAIN_SAFETY_MARGIN - 0.001);
      // Each 300 s cruise ends in a climb to the top and a dive of at most 6 m/s.
      expect(dives).toBeGreaterThanOrEqual(4);
      expect(fastestDive).toBeLessThanOrEqual(CYCLE.diveRate.max + 0.001);
      expect(seekingTurns).toBeGreaterThan(10);
      expect(circleEntries).toBeGreaterThan(0);
      // Total flap time is unrestricted. Thermal/ridge no-flap rules remain checked above.
      expect(Math.hypot(navigator.state.x - start.x, navigator.state.z - start.z)).toBeGreaterThan(700);
      expect(behaviors.has('thermal-seeking')).toBe(true);
      expect(behaviors.has('thermal-riding')).toBe(true);
      // Highland faces may add ridge-soaring; nothing else is allowed.
      for (const behavior of behaviors) {
        expect(['gliding', 'thermal-seeking', 'thermal-riding', 'ridge-soaring']).toContain(behavior);
      }
    },
    20_000,
  );

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
    const navigator = new EagleNavigator(world, world.scenicStart(2), FLIGHT_HEIGHT);
    const ground = world.sample(navigator.state.x, navigator.state.z).height;
    navigator.state.y = ground + FLIGHT_HEIGHT.min + 5; // just under the soft floor trigger
    const before = navigator.state.y;
    const state = navigator.update(0.1);
    expect(state.flapping).toBe(true);
    expect(state.y).toBeGreaterThan(before);
  });

  it('the up arrow flaps below the maximum, and the down arrow sinks faster above the floor', () => {
    const world = new WorldModel(448122);
    const at = (clearance: number, climb: number) => {
      const navigator = new EagleNavigator(world, world.scenicStart(2), FLIGHT_HEIGHT);
      navigator.state.y = world.sample(navigator.state.x, navigator.state.z).height + clearance;
      navigator.setNudge({ turn: 0, climb });
      const before = navigator.state.y;
      let flapped = false;
      for (let step = 0; step < 10; step += 1) flapped = navigator.update(0.1).flapping || flapped;
      return { flapped, change: navigator.state.y - before };
    };
    expect(at(250, 1).flapped).toBe(true);
    expect(at(250, 1).change).toBeGreaterThan(0);
    // Above the maximum the up arrow does not power a climb.
    expect(at(1000, 1).flapped).toBe(false);
    expect(at(250, -1).flapped).toBe(false);
    expect(at(250, -1).change).toBeLessThan(at(250, 0).change - 3);
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
    const wing = view.group.getObjectByName('left-shoulder');
    expect(wing).toBeDefined();
    // Flaps ease in and out, so sample a second of each.
    const stroke = (flapping: boolean) => {
      state.flapping = flapping;
      let largest = 0;
      for (let frame = 0; frame < 60; frame += 1) {
        view.update(state, 1 / 60);
        largest = Math.max(largest, Math.abs(wing!.rotation.z));
      }
      return largest;
    };
    expect(stroke(true)).toBeGreaterThan(0.4);
    stroke(false);
    // A gliding wing holds only its shallow dihedral.
    expect(stroke(false)).toBeLessThan(0.2);
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
      for (let step = 0; step < 36_000 && radii.length < 100; step += 1) {
        const before = navigator.state.behavior;
        const state = navigator.update(0.1);
        if (before !== 'thermal-riding' && state.behavior === 'thermal-riding' && navigator.activeThermal) {
          riding = true;
          const ground = world.sample(state.x, state.z).height;
          state.y = ground + FLIGHT_HEIGHT.min + 40;
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
        if (elapsed < 24) continue; // the circle slides onto the core over about 8 s
        expect(state.flapping).toBe(false);
        const radius = Math.hypot(state.x - navigator.activeThermal.x, state.z - navigator.activeThermal.z);
        radii.push(radius);
        banks.push(Math.abs(state.bank));
        expect(Math.abs(state.bank)).toBeGreaterThanOrEqual(THERMAL_BANK_RANGE.min - 0.02);
        expect(Math.abs(state.bank)).toBeLessThanOrEqual(THERMAL_BANK_RANGE.max + 0.02);
        expect(radius).toBeGreaterThan(THERMAL_RADIUS_RANGE.min - 12);
        expect(radius).toBeLessThan(THERMAL_RADIUS_RANGE.max + 12);
      }
      expect(radii.length).toBeGreaterThan(60);
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
        state.y = ground + FLIGHT_HEIGHT.min + 20;
        held = 0;
        continue;
      }
      if (riding && state.behavior === 'thermal-riding') held += 0.1;
      else if (riding) break;
    }
    expect(held).toBeGreaterThan(19);
  });

  it('leaves thermal-riding at the cycle top, near 700 m above sea level, and dives', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    let exitY: number | null = null;
    for (let step = 0; step < 36_000 && exitY === null; step += 1) {
      const before = navigator.state.behavior;
      const top = navigator.cycle.top;
      const state = navigator.update(0.1);
      if (before === 'thermal-riding' && state.behavior !== 'thermal-riding' && state.y >= top - 1) {
        expect(navigator.cycle.phase).toBe('dive');
        exitY = state.y;
      }
    }
    expect(exitY).not.toBeNull();
    expect(exitY!).toBeGreaterThanOrEqual(CYCLE.top - CYCLE.topVariation - 1);
    expect(exitY!).toBeLessThanOrEqual(CYCLE.top + CYCLE.topVariation + 1);
  });

  it('dives at 5–6 m/s into a 50–150 m cruise, holds it by flapping, and steers toward the sky', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    const bearing = 1.2;
    navigator.setSkyBearing(bearing);
    const rates: number[] = [];
    const cruise: number[] = [];
    let cruiseFlaps = 0;
    let towardSky = 0;
    let cruiseTicks = 0;
    let reachedCruise = false;
    let wasFlapping = false;
    for (let step = 0; step < 36_000 && cruiseTicks < 2400; step += 1) {
      const phase = navigator.cycle.phase;
      const previousY = navigator.state.y;
      const state = navigator.update(0.1);
      const flapped = navigator.state.flapping;
      if (phase === 'dive' && navigator.cycle.phase === 'dive' && !state.flapping && !wasFlapping) rates.push((previousY - state.y) / 0.1);
      wasFlapping = flapped;
      if (phase === 'dive' && navigator.cycle.phase === 'cruise') reachedCruise = true;
      if (!reachedCruise || navigator.cycle.phase !== 'cruise' || state.behavior !== 'gliding') continue;
      cruiseTicks += 1;
      cruise.push(state.y - navigator.flightGround);
      if (state.flapping) cruiseFlaps += 1;
      if (Math.cos(state.heading - bearing) > 0) towardSky += 1;
    }
    expect(reachedCruise).toBe(true);
    // Over rising ground the dive eases to a 1 m/s glide; otherwise it sinks at this cycle's 5–6 m/s.
    const diving = rates.filter((rate) => rate > GLIDE_SINK_RATE + 0.001);
    expect(diving.length).toBeGreaterThan(rates.length * 0.6);
    expect(Math.min(...diving)).toBeGreaterThanOrEqual(CYCLE.diveRate.min - 0.001);
    expect(Math.max(...diving)).toBeLessThanOrEqual(CYCLE.diveRate.max + 0.001);
    // The cruise band is 50–150 m, wandering by up to 30 m; a flap burst can overshoot by a few metres.
    expect(Math.min(...cruise)).toBeGreaterThan(CYCLE.cruise.min - 10);
    expect(Math.max(...cruise)).toBeLessThan(CYCLE.cruise.max + CYCLE.cruiseWander + 10);
    expect(cruiseFlaps).toBeGreaterThan(0);
    expect(towardSky / cruiseTicks).toBeGreaterThan(0.75);
  });
});

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EagleNavigator } from '../src/eagle';
import { THERMAL_MARKER_RANGE, ThermalMarker } from '../src/thermal-marker';
import { WorldModel } from '../src/world';

const key = (x: number, z: number): string => `${x},${z}`;

function inRangeOf(world: WorldModel, x: number, z: number) {
  return world.nearbyThermals(x, z, 6).filter((thermal) => Math.hypot(thermal.x - x, thermal.z - z) <= THERMAL_MARKER_RANGE);
}

describe('thermal markers within 3.5 km', () => {
  it('reuses one instanced column for every in-range thermal and hides the rest', () => {
    const scene = new THREE.Scene();
    const world = new WorldModel(448122);
    const marker = new ThermalMarker(scene, world);
    const origin = world.thermalAtCell(0, 0)!;
    const neighbor = world.thermalAtCell(1, 1)!;
    const distant = world.thermalAtCell(8, 0)!;
    expect(origin).toBeTruthy();
    expect(neighbor).toBeTruthy();
    expect(distant).toBeTruthy();
    expect(Math.hypot(neighbor.x - origin.x, neighbor.z - origin.z)).toBeLessThanOrEqual(THERMAL_MARKER_RANGE);
    expect(Math.hypot(distant.x - origin.x, distant.z - origin.z)).toBeGreaterThan(THERMAL_MARKER_RANGE);

    const geometry = marker.mesh.geometry;
    const material = marker.mesh.material;
    expect(scene.children).toEqual([marker.mesh]);
    expect(marker.mesh.visible).toBe(false);
    expect(marker.count).toBe(0);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(geometry.parameters.openEnded).toBe(true);

    marker.update(origin, origin, true, 1);
    const shown = marker.placements();
    const expected = inRangeOf(world, origin.x, origin.z);
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect(shown.map((placed) => key(placed.x, placed.z)).sort()).toEqual(expected.map((thermal) => key(thermal.x, thermal.z)).sort());
    expect(shown.some((placed) => placed.x === distant.x && placed.z === distant.z)).toBe(false);
    expect(shown.every((placed) => Math.hypot(placed.x - origin.x, placed.z - origin.z) <= THERMAL_MARKER_RANGE)).toBe(true);
    const active = shown.find((placed) => placed.x === origin.x && placed.z === origin.z);
    const quiet = shown.find((placed) => placed.x === neighbor.x && placed.z === neighbor.z);
    expect(active?.active).toBe(true);
    expect(quiet?.active).toBe(false);
    expect(active?.y).toBeCloseTo(world.sample(origin.x, origin.z).height + 133);
    expect(quiet!.y).toBeGreaterThan(world.sample(neighbor.x, neighbor.z).height + 133);
    const matrices = marker.mesh.instanceMatrix.array;
    const activeIndex = shown.findIndex((placed) => placed.active);
    expect(matrices[activeIndex * 16 + 12]).toBeCloseTo(origin.x, 2);
    expect(matrices[activeIndex * 16 + 14]).toBeCloseTo(origin.z, 2);
    expect(matrices[activeIndex * 16]).toBeCloseTo(1, 5);
    const colors = marker.mesh.instanceColor!.array;
    const quietIndex = shown.findIndex((placed) => placed.x === neighbor.x && placed.z === neighbor.z);
    expect(colors[activeIndex * 3]).toBe(1);
    expect(colors[quietIndex * 3]).toBe(0);
    expect(material.uniforms.time?.value).toBe(1);

    marker.update(origin, origin, false, 2);
    expect(marker.mesh.visible).toBe(false);
    expect(marker.placements()).toEqual([]);

    origin.x += 9;
    origin.z -= 4;
    marker.update({ x: origin.x, z: origin.z }, origin, true, 3);
    const followed = marker.placements().find((placed) => placed.active);
    expect(followed).toMatchObject({ x: origin.x, z: origin.z });
    expect(scene.children).toEqual([marker.mesh]);
    expect(marker.mesh.geometry).toBe(geometry);
    expect(marker.mesh.material).toBe(material);
    marker.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('tracks every in-range thermal through seeking, circling, and replacement', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    const marker = new ThermalMarker(new THREE.Scene(), world);
    let seeking = false;
    let circling = false;
    const activeTargets = new Set<string>();
    for (let step = 0; step < 12_000; step += 1) {
      navigator.update(0.1);
      const state = navigator.state;
      marker.update(state, navigator.activeThermal, true, step * 0.1);
      const expected = inRangeOf(world, state.x, state.z);
      const shown = marker.placements();
      expect(shown.map((placed) => key(placed.x, placed.z)).sort()).toEqual(expected.map((thermal) => key(thermal.x, thermal.z)).sort());
      expect(shown.filter((placed) => Math.hypot(placed.x - state.x, placed.z - state.z) > THERMAL_MARKER_RANGE)).toEqual([]);
      const active = navigator.activeThermal;
      const flagged = shown.filter((placed) => placed.active);
      if (active && Math.hypot(active.x - state.x, active.z - state.z) <= THERMAL_MARKER_RANGE) {
        expect(flagged).toHaveLength(1);
        expect(flagged[0]).toMatchObject({ x: active.x, z: active.z });
        activeTargets.add(key(active.x, active.z));
      } else {
        expect(flagged).toEqual([]);
      }
      seeking ||= state.behavior === 'thermal-seeking';
      circling ||= state.behavior === 'thermal-riding';
      if (seeking && circling && activeTargets.size >= 2 && expected.length >= 2) break;
    }
    expect(seeking).toBe(true);
    expect(circling).toBe(true);
    expect(activeTargets.size).toBeGreaterThanOrEqual(2);
    marker.update(navigator.state, navigator.activeThermal, false, 4);
    expect(marker.count).toBe(0);
    marker.dispose();
  });
});

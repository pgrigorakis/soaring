import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EagleNavigator } from '../src/eagle';
import { ThermalMarker } from '../src/thermal-marker';
import { WorldModel } from '../src/world';

describe('active thermal marker', () => {
  it('reuses one transparent column across targets and visibility changes', () => {
    const scene = new THREE.Scene();
    const world = new WorldModel(448122);
    const marker = new ThermalMarker(scene, world);
    const first = world.thermalAtCell(0, 0);
    const second = world.thermalAtCell(1, 1);
    const geometry = marker.mesh.geometry;
    const material = marker.mesh.material;

    expect(scene.children).toEqual([marker.mesh]);
    expect(marker.mesh.visible).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(geometry.parameters.openEnded).toBe(true);
    marker.update(first, true, 1);
    expect(marker.mesh.visible).toBe(true);
    expect([marker.mesh.position.x, marker.mesh.position.z]).toEqual([first.x, first.z]);
    expect(marker.mesh.position.y).toBeCloseTo(world.sample(first.x, first.z).height + 133);
    marker.update(second, false, 2);
    expect(marker.mesh.visible).toBe(false);
    marker.update(second, true, 3);
    expect([marker.mesh.position.x, marker.mesh.position.z]).toEqual([second.x, second.z]);
    expect(material.uniforms.time?.value).toBe(3);
    marker.update(null, true, 4);
    expect(marker.mesh.visible).toBe(false);
    expect(scene.children).toEqual([marker.mesh]);
    expect(marker.mesh.geometry).toBe(geometry);
    expect(marker.mesh.material).toBe(material);
    marker.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('tracks the navigator thermal through seeking, circling, and replacement', () => {
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    const marker = new ThermalMarker(new THREE.Scene(), world);
    let seeking = false;
    let circling = false;
    const targets = new Set<string>();
    for (let step = 0; step < 12_000; step += 1) {
      navigator.update(0.1);
      marker.update(navigator.activeThermal, true, step * 0.1);
      const active = navigator.activeThermal;
      expect(marker.mesh.visible).toBe(active !== null);
      if (active) {
        expect([marker.mesh.position.x, marker.mesh.position.z]).toEqual([active.x, active.z]);
        targets.add(`${active.x},${active.z}`);
      }
      seeking ||= navigator.state.behavior === 'thermal-seeking';
      circling ||= navigator.state.behavior === 'thermal-riding';
      if (seeking && circling && targets.size >= 2) break;
    }
    expect(seeking).toBe(true);
    expect(circling).toBe(true);
    expect(targets.size).toBeGreaterThanOrEqual(2);
    marker.dispose();
  });
});

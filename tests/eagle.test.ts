import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  EagleNavigator, EagleView, inwardThermalBankSign, RIDGE, ridgeClimb, THERMAL_CLIMB_RANGE, type EagleState,
} from '../src/eagle';
import { WorldModel } from '../src/world';

describe('procedural eagle', () => {
  it('has a broad symmetric feathered silhouette and reuses its geometry in flight', () => {
    const eagle = new EagleView();
    const meshes: THREE.Mesh[] = [];
    eagle.group.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });
    const bounds = new THREE.Box3().setFromObject(eagle.group);
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x / size.z).toBeGreaterThan(2);
    expect(Math.abs(bounds.min.x + bounds.max.x)).toBeLessThan(0.05);
    // One skinned draw call carries the body, both wings and the tail.
    expect(meshes).toHaveLength(1);
    expect(meshes[0]).toBeInstanceOf(THREE.SkinnedMesh);

    const geometries = meshes.map((mesh) => mesh.geometry);
    const state: EagleState = { x: 14, y: 70, z: -9, heading: 0.7, bank: -0.25, behavior: 'thermal-riding', flapping: false };
    for (let frame = 0; frame < 240; frame += 1) eagle.update(state, 1 / 60);
    expect(eagle.group.position.toArray()).toEqual([14, 70, -9]);
    expect(eagle.group.rotation.y).toBe(0.7);
    expect(eagle.group.rotation.z).toBe(-0.25);
    const flownGeometries: THREE.BufferGeometry[] = [];
    eagle.group.traverse((object) => {
      if (object instanceof THREE.Mesh) flownGeometries.push(object.geometry);
    });
    expect(flownGeometries).toHaveLength(geometries.length);
    flownGeometries.forEach((geometry, index) => expect(geometry).toBe(geometries[index]));
  });

  it('lowers the left wing when bank is positive', () => {
    const eagle = new EagleView();
    eagle.update(pose({ heading: 0.4, bank: 0.5 }), 1 / 60);
    const wings = wingWorldPositions(eagle);
    expect(wings.left.y).toBeLessThan(wings.right.y);
  });

  it('banks toward the thermal for either circling direction', () => {
    const thermal = { x: 20, z: -15 };
    const radius = 48;
    for (const orbit of [1, -1] as const) {
      const circleAngle = 0.7;
      const birdX = thermal.x + Math.cos(circleAngle) * radius;
      const birdZ = thermal.z + Math.sin(circleAngle) * radius;
      // Orbit angle increases counterclockwise in XZ; heading tracks the opposite tangent.
      const heading = orbit > 0 ? -circleAngle : Math.PI - circleAngle;
      const bank = inwardThermalBankSign(heading, birdX, birdZ, thermal.x, thermal.z) * 0.45;
      const eagle = new EagleView();
      eagle.update(pose({ x: birdX, y: 80, z: birdZ, heading, bank }), 1 / 60);
      const wings = wingWorldPositions(eagle);
      const lower = wings.left.y < wings.right.y ? wings.left : wings.right;
      const higher = lower === wings.left ? wings.right : wings.left;
      const distance = (wing: THREE.Vector3) => Math.hypot(wing.x - thermal.x, wing.z - thermal.z);
      expect(distance(lower)).toBeLessThan(distance(higher));
    }
  });

  it('circles with the rendered bank toward the thermal and climbs at 12–16 m/s', () => {
    expect(THERMAL_CLIMB_RANGE).toEqual({ min: 12, max: 16 });
    const world = new WorldModel(448122);
    const navigator = new EagleNavigator(world, world.scenicStart(2));
    let riding = false;
    let checkedBank = false;
    let checkedClimb = false;
    for (let step = 0; step < 36_000 && !(checkedBank && checkedClimb); step += 1) {
      const before = navigator.state.behavior;
      const state = navigator.update(0.1);
      if (before === 'thermal-riding' || state.behavior !== 'thermal-riding' || !navigator.activeThermal) continue;
      const thermal = navigator.activeThermal;
      const ground = world.sample(state.x, state.z).height;
      state.y = ground + 80;
      thermal.strength = 0.72;
      const weakBefore = state.y;
      const weak = navigator.update(0.1);
      // Entry on a weak thermal decays lift for one tick before this sample, so the rate is the band, not an exact tenth.
      expect((weak.y - weakBefore) / 0.1).toBeCloseTo(THERMAL_CLIMB_RANGE.min, 1);
      thermal.strength = 1.44;
      const strongBefore = weak.y;
      const strong = navigator.update(0.1);
      expect((strong.y - strongBefore) / 0.1).toBeCloseTo(THERMAL_CLIMB_RANGE.max, 1);
      checkedClimb = true;

      for (let settle = 0; settle < 30 && navigator.state.behavior === 'thermal-riding'; settle += 1) {
        navigator.update(0.1);
      }
      expect(navigator.state.behavior).toBe('thermal-riding');
      const ridden = navigator.state;
      // The bird banks toward the circle it flies, which eases from the entry tangent onto the thermal.
      const center = navigator.orbitCentre;
      expect(center).not.toBeNull();
      const sign = inwardThermalBankSign(ridden.heading, ridden.x, ridden.z, center!.x, center!.z);
      expect(Math.sign(ridden.bank)).toBe(sign);
      const eagle = new EagleView();
      eagle.update(ridden, 1 / 60);
      const wings = wingWorldPositions(eagle);
      const lower = wings.left.y < wings.right.y ? wings.left : wings.right;
      const higher = lower === wings.left ? wings.right : wings.left;
      const distance = (wing: THREE.Vector3) => Math.hypot(wing.x - center!.x, wing.z - center!.z);
      expect(distance(lower)).toBeLessThan(distance(higher));
      checkedBank = true;
      riding = true;
    }
    expect(riding).toBe(true);
    expect(checkedBank && checkedClimb).toBe(true);
  });

  it('keeps windward lift on a peaked crest and rejects a lee face, a flat face, and a short spur', () => {
    const wind = { x: 8, z: 0, speed: 8, angle: 0 };
    const peaked = 20 * Math.PI / 180;
    expect(ridgeClimb(peaked, 0, wind)).toBeGreaterThanOrEqual(RIDGE.enterClimb);
    expect(ridgeClimb(peaked, Math.PI, wind)).toBe(0);
    expect(ridgeClimb(5 * Math.PI / 180, 0, wind)).toBeLessThan(RIDGE.enterClimb);
    expect(RIDGE.minSlope).toBe(18 * Math.PI / 180);
    expect(RIDGE.crestDrop).toBe(40);
    expect(RIDGE.minSegment).toBe(320);
    expect(RIDGE.minSegment).toBeGreaterThan(RIDGE.segmentStep * 2);
  });
});

function pose(overrides: Partial<EagleState> = {}): EagleState {
  return {
    x: 0, y: 40, z: 0, heading: 0, bank: 0, behavior: 'thermal-riding', flapping: false, ...overrides,
  };
}

function wingWorldPositions(eagle: EagleView): { left: THREE.Vector3; right: THREE.Vector3 } {
  eagle.group.updateMatrixWorld(true);
  const left = eagle.group.getObjectByName('left-wrist');
  const right = eagle.group.getObjectByName('right-wrist');
  if (!left || !right) throw new Error('wing bones missing');
  return {
    left: left.getWorldPosition(new THREE.Vector3()),
    right: right.getWorldPosition(new THREE.Vector3()),
  };
}

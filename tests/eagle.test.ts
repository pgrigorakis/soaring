import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EagleView, type EagleState } from '../src/eagle';

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
    expect(meshes.length).toBeLessThan(25);
    expect(meshes.filter((mesh) => mesh.geometry.getAttribute('color'))).toHaveLength(3);

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
});

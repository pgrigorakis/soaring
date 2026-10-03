import * as THREE from 'three';

const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * One instanced mesh shared by every loaded tile, so each tree shape costs one draw call for the whole ring.
 * Callers pass world matrices. The pool stores them relative to its anchor, which follows the stream, so
 * float32 instance data stays precise on long flights. A freed slot collapses to zero scale and is reused.
 */
export class InstancePool {
  mesh: THREE.InstancedMesh;
  /** Times the pool outgrew its capacity. Growing keeps every tree; the capacity should make this zero. */
  grown = 0;
  private readonly free: number[] = [];
  private live = 0;

  constructor(private readonly parent: THREE.Object3D, name: string, capacity: number,
    geometry: THREE.BufferGeometry, material: THREE.Material, private readonly colored: boolean,
    private readonly castShadow: boolean) {
    this.mesh = this.createMesh(name, capacity, geometry, material);
    parent.add(this.mesh);
  }

  get capacity(): number { return this.mesh.instanceMatrix.count; }
  get used(): number { return this.live; }

  add(matrix: THREE.Matrix4, color?: THREE.Color): number {
    if (this.free.length === 0 && this.mesh.count === this.capacity) this.grow();
    const slot = this.free.pop() ?? this.mesh.count++;
    const elements = this.mesh.instanceMatrix.array;
    matrix.toArray(elements, slot * 16);
    elements[slot * 16 + 12]! -= this.mesh.position.x;
    elements[slot * 16 + 14]! -= this.mesh.position.z;
    this.touch(slot);
    if (color && this.mesh.instanceColor) {
      color.toArray(this.mesh.instanceColor.array, slot * 3);
      this.mesh.instanceColor.addUpdateRange(slot * 3, 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.live += 1;
    return slot;
  }

  remove(slot: number): void {
    this.live -= 1;
    if (this.live === 0) {
      // An empty pool restarts from slot zero so a cleared stream does not keep drawing hidden slots.
      this.free.length = 0;
      this.mesh.count = 0;
      return;
    }
    hidden.toArray(this.mesh.instanceMatrix.array, slot * 16);
    this.touch(slot);
    this.free.push(slot);
  }

  /** Moves the anchor to a world point without moving any instance. */
  reanchor(x: number, z: number): void {
    const dx = this.mesh.position.x - x;
    const dz = this.mesh.position.z - z;
    if (dx === 0 && dz === 0) return;
    const elements = this.mesh.instanceMatrix.array;
    for (let slot = 0; slot < this.mesh.count; slot += 1) {
      elements[slot * 16 + 12]! += dx;
      elements[slot * 16 + 14]! += dz;
    }
    this.mesh.position.set(x, 0, z);
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }

  private touch(slot: number): void {
    this.mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private createMesh(name: string, capacity: number, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = this.castShadow;
    // The pool spans the whole ring, so a bounding test would never cull it.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.colored) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    return mesh;
  }

  private grow(): void {
    const old = this.mesh;
    const mesh = this.createMesh(old.name, this.capacity * 2, old.geometry, old.material as THREE.Material);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    if (old.instanceColor && mesh.instanceColor) mesh.instanceColor.array.set(old.instanceColor.array);
    mesh.count = old.count;
    mesh.position.copy(old.position);
    this.parent.remove(old);
    old.dispose();
    this.parent.add(mesh);
    this.mesh = mesh;
    this.grown += 1;
  }
}

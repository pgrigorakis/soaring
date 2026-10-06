import * as THREE from 'three';

const centre = new THREE.Vector3();
const tip = new THREE.Vector3();

/**
 * One instanced mesh shared by every loaded tile, so each tree shape costs one draw call for the whole ring.
 * Callers pass world matrices. The pool stores them relative to its anchor, which follows the stream, so
 * float32 instance data stays precise on long flights. A freed slot is skipped and reused.
 *
 * The pool spans the whole ring, so a bounding test on the mesh would never cull it. Instead `cull` copies
 * only the instances near the view into the drawn buffers before each render, so software WebGL does not
 * shade every tree behind the camera.
 */
export class InstancePool {
  mesh: THREE.InstancedMesh;
  /** Times the pool outgrew its capacity. Growing keeps every tree; the capacity should make this zero. */
  grown = 0;
  private readonly free: number[] = [];
  private live = 0;
  private slots = 0;
  private matrices: Float32Array;
  private colors: Float32Array;
  /** Bounding sphere per slot relative to the anchor: centre xyz and radius. A freed slot has radius -1. */
  private spheres: Float32Array;
  private readonly sphere: THREE.Sphere;

  constructor(private readonly parent: THREE.Object3D, name: string, capacity: number,
    geometry: THREE.BufferGeometry, material: THREE.Material, private readonly colored: boolean,
    private readonly castShadow: boolean, private readonly depthMaterial?: THREE.Material) {
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    this.sphere = geometry.boundingSphere!;
    this.matrices = new Float32Array(capacity * 16);
    this.colors = new Float32Array(colored ? capacity * 3 : 0);
    this.spheres = new Float32Array(capacity * 4);
    this.mesh = this.createMesh(name, capacity, geometry, material);
    parent.add(this.mesh);
  }

  get capacity(): number { return this.spheres.length / 4; }
  get used(): number { return this.live; }

  add(matrix: THREE.Matrix4, color?: THREE.Color): number {
    if (this.free.length === 0 && this.slots === this.capacity) this.grow();
    const slot = this.free.pop() ?? this.slots++;
    matrix.toArray(this.matrices, slot * 16);
    // Subtract in float64 before storing, or float32 rounding of the world position defeats the anchor.
    this.matrices[slot * 16 + 12] = matrix.elements[12] - this.mesh.position.x;
    this.matrices[slot * 16 + 14] = matrix.elements[14] - this.mesh.position.z;
    centre.copy(this.sphere.center).applyMatrix4(matrix);
    this.spheres[slot * 4] = centre.x - this.mesh.position.x;
    this.spheres[slot * 4 + 1] = centre.y;
    this.spheres[slot * 4 + 2] = centre.z - this.mesh.position.z;
    this.spheres[slot * 4 + 3] = this.sphere.radius * matrix.getMaxScaleOnAxis();
    if (color && this.colored) color.toArray(this.colors, slot * 3);
    this.live += 1;
    return slot;
  }

  remove(slot: number): void {
    this.live -= 1;
    if (this.live === 0) {
      // An empty pool restarts from slot zero so a cleared stream does not keep scanning freed slots.
      this.free.length = 0;
      this.slots = 0;
      this.mesh.count = 0;
      return;
    }
    this.spheres[slot * 4 + 3] = -1;
    this.free.push(slot);
  }

  /** Moves the anchor to a world point without moving any instance. */
  reanchor(x: number, z: number): void {
    const dx = this.mesh.position.x - x;
    const dz = this.mesh.position.z - z;
    if (dx === 0 && dz === 0) return;
    for (let slot = 0; slot < this.slots; slot += 1) {
      this.matrices[slot * 16 + 12]! += dx;
      this.matrices[slot * 16 + 14]! += dz;
      this.spheres[slot * 4]! += dx;
      this.spheres[slot * 4 + 2]! += dz;
    }
    this.mesh.position.set(x, 0, z);
  }

  /**
   * Draws only the instances whose bounding sphere touches the frustum, which is in the parent's render
   * space. If `shadow` is set, each sphere also sweeps along that offset, so a tree outside the view still
   * casts its shadow into it.
   */
  cull(frustum: THREE.Frustum, shadow: THREE.Vector3 | null): void {
    const drawn = this.mesh.instanceMatrix.array as Float32Array;
    const drawnColors = this.mesh.instanceColor?.array as Float32Array | undefined;
    const { x: ox, y: oy, z: oz } = this.mesh.position;
    let count = 0;
    for (let slot = 0; slot < this.slots; slot += 1) {
      const radius = this.spheres[slot * 4 + 3]!;
      if (radius < 0) continue;
      centre.set(this.spheres[slot * 4]! + ox, this.spheres[slot * 4 + 1]! + oy, this.spheres[slot * 4 + 2]! + oz)
        .applyMatrix4(this.parent.matrixWorld);
      if (!touches(frustum, centre, shadow && tip.copy(centre).add(shadow), radius)) continue;
      drawn.set(this.matrices.subarray(slot * 16, slot * 16 + 16), count * 16);
      if (drawnColors) drawnColors.set(this.colors.subarray(slot * 3, slot * 3 + 3), count * 3);
      count += 1;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, count * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }

  private createMesh(name: string, capacity: number, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = this.castShadow;
    if (this.depthMaterial) mesh.customDepthMaterial = this.depthMaterial;
    // `cull` picks the drawn instances, so the whole-mesh test would only cost time.
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
    const capacity = this.capacity * 2;
    const mesh = this.createMesh(old.name, capacity, old.geometry, old.material as THREE.Material);
    const matrices = new Float32Array(capacity * 16);
    matrices.set(this.matrices);
    this.matrices = matrices;
    const colors = new Float32Array(this.colored ? capacity * 3 : 0);
    colors.set(this.colors);
    this.colors = colors;
    const spheres = new Float32Array(capacity * 4);
    spheres.set(this.spheres);
    this.spheres = spheres;
    mesh.position.copy(old.position);
    this.parent.remove(old);
    old.dispose();
    this.parent.add(mesh);
    this.mesh = mesh;
    this.grown += 1;
  }
}

/** True if a sphere, or the capsule it sweeps to `end`, is not wholly behind any frustum plane. */
function touches(frustum: THREE.Frustum, start: THREE.Vector3, end: THREE.Vector3 | null, radius: number): boolean {
  for (const plane of frustum.planes) {
    if (plane.distanceToPoint(start) < -radius && (!end || plane.distanceToPoint(end) < -radius)) return false;
  }
  return true;
}

import * as THREE from 'three';

const QUADS = 16; // per block
const VERTICES = QUADS * 4;
const INDICES = QUADS * 6;

/**
 * One water mesh for every loaded tile, so the ring's water costs one draw call. A tile copies its finished
 * water quads into fixed blocks; a freed block keeps all-zero indices, which draw nothing. Positions are
 * stored relative to the anchor, as in InstancePool, so float32 vertices stay precise on long flights.
 */
export class WaterPool {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /** Times the pool outgrew its capacity. Growing keeps every quad; the capacity should make this zero. */
  grown = 0;
  private readonly free: number[] = [];
  private blocks = 0;
  private live = 0;

  constructor(private readonly parent: THREE.Object3D, capacity: number, material: THREE.Material) {
    this.mesh = new THREE.Mesh(this.createGeometry(capacity), material);
    this.mesh.name = 'water';
    // The pool spans the whole ring, so a bounding test would never cull it.
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }

  get capacity(): number { return this.mesh.geometry.index!.count / INDICES; }
  get used(): number { return this.live; }

  /** Copies the quads of a tile's water geometry, laid out as four vertices per quad, at a world origin. */
  add(source: THREE.BufferGeometry, originX: number, originZ: number): number[] {
    const quads = source.getAttribute('position').count / 4;
    const claimed: number[] = [];
    const offsetX = originX - this.mesh.position.x;
    const offsetZ = originZ - this.mesh.position.z;
    for (let first = 0; first < quads; first += QUADS) {
      if (this.free.length === 0 && this.blocks === this.capacity) this.grow();
      const block = this.free.pop() ?? this.blocks++;
      const count = Math.min(QUADS, quads - first);
      const geometry = this.mesh.geometry;
      for (const name of ['position', 'color', 'normal', 'waterDepth']) {
        const from = source.getAttribute(name) as THREE.BufferAttribute;
        const to = geometry.getAttribute(name) as THREE.BufferAttribute;
        const size = to.itemSize;
        to.array.set(from.array.subarray(first * 4 * size, (first + count) * 4 * size), block * VERTICES * size);
        to.addUpdateRange(block * VERTICES * size, count * 4 * size);
        to.needsUpdate = true;
      }
      const positions = geometry.getAttribute('position').array;
      for (let vertex = block * VERTICES; vertex < block * VERTICES + count * 4; vertex += 1) {
        positions[vertex * 3]! += offsetX;
        positions[vertex * 3 + 2]! += offsetZ;
      }
      const indices = geometry.index!.array;
      for (let quad = 0; quad < QUADS; quad += 1) {
        const base = block * VERTICES + quad * 4;
        const at = block * INDICES + quad * 6;
        if (quad < count) {
          indices[at] = base; indices[at + 1] = base + 2; indices[at + 2] = base + 1;
          indices[at + 3] = base + 1; indices[at + 4] = base + 2; indices[at + 5] = base + 3;
        } else indices.fill(0, at, at + 6);
      }
      this.touchIndices(block);
      claimed.push(block);
    }
    this.live += claimed.length;
    this.mesh.geometry.setDrawRange(0, this.blocks * INDICES);
    return claimed;
  }

  remove(blocks: number[]): void {
    this.live -= blocks.length;
    if (this.live === 0) {
      // An empty pool restarts from block zero so a cleared stream does not keep drawing empty blocks.
      this.free.length = 0;
      this.blocks = 0;
      this.mesh.geometry.setDrawRange(0, 0);
      return;
    }
    for (const block of blocks) {
      this.mesh.geometry.index!.array.fill(0, block * INDICES, (block + 1) * INDICES);
      this.touchIndices(block);
      this.free.push(block);
    }
  }

  /** Moves the anchor to a world point without moving any water. */
  reanchor(x: number, z: number): void {
    const dx = this.mesh.position.x - x;
    const dz = this.mesh.position.z - z;
    if (dx === 0 && dz === 0) return;
    const position = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let vertex = 0; vertex < this.blocks * VERTICES; vertex += 1) {
      position.array[vertex * 3]! += dx;
      position.array[vertex * 3 + 2]! += dz;
    }
    this.mesh.position.set(x, 0, z);
    position.clearUpdateRanges();
    position.needsUpdate = true;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
  }

  private touchIndices(block: number): void {
    const index = this.mesh.geometry.index!;
    index.addUpdateRange(block * INDICES, INDICES);
    index.needsUpdate = true;
  }

  private createGeometry(blocks: number): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const vertices = blocks * VERTICES;
    for (const [name, size] of [['position', 3], ['color', 3], ['normal', 3], ['waterDepth', 1]] as const) {
      geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(vertices * size), size).setUsage(THREE.DynamicDrawUsage));
    }
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(blocks * INDICES), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    // Transparent sorting reads this sphere; a fixed one at the anchor avoids scanning every vertex.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    return geometry;
  }

  private grow(): void {
    const old = this.mesh.geometry;
    const geometry = this.createGeometry(this.capacity * 2);
    for (const name of ['position', 'color', 'normal', 'waterDepth']) {
      (geometry.getAttribute(name) as THREE.BufferAttribute).array.set(old.getAttribute(name).array);
    }
    geometry.index!.array.set(old.index!.array);
    this.mesh.geometry = geometry;
    old.dispose();
    this.grown += 1;
  }
}

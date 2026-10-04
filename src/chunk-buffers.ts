import * as THREE from 'three';

/** Fixed tier capacity. Only detached chunks may return these buffers to the stream. */
export class ChunkBuffers {
  readonly geometry = new THREE.BufferGeometry();
  readonly water = new THREE.BufferGeometry();
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint16Array;
  readonly waterPositions: Float32Array;
  readonly waterColors: Float32Array;
  readonly depths: Float32Array;
  readonly waterIndices: Uint16Array;

  constructor(segments: number, waterSegments: number) {
    const vertices = (segments + 1) ** 2;
    this.positions = new Float32Array(vertices * 3);
    this.normals = new Float32Array(vertices * 3);
    this.colors = new Float32Array(vertices * 3);
    this.indices = new Uint16Array(segments * segments * 6);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
    const cells = waterSegments ** 2;
    this.waterPositions = new Float32Array(cells * 12);
    this.waterColors = new Float32Array(cells * 12);
    this.depths = new Float32Array(cells * 4);
    this.waterIndices = new Uint16Array(cells * 6);
    this.water.setAttribute('position', new THREE.BufferAttribute(this.waterPositions, 3));
    this.water.setAttribute('color', new THREE.BufferAttribute(this.waterColors, 3));
    this.water.setAttribute('waterDepth', new THREE.BufferAttribute(this.depths, 1));
    this.water.setIndex(new THREE.BufferAttribute(this.waterIndices, 1));
    // Allocate once. computeVertexNormals subsequently writes into this same buffer.
    this.water.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cells * 12), 3));
  }

  dispose(): void { this.geometry.dispose(); this.water.dispose(); }
}

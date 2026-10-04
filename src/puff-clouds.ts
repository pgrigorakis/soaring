import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PUFF_CLOUD_COUNT = 40;
export const PUFF_CLOUD_FIELD = 6400;
export const PUFF_CLOUD_DECK = 600;

export type PuffCloudLayout = {
  offsetX: number;
  offsetZ: number;
  height: number;
  width: number;
  driftSpeed: number;
};

export type PuffCloudPlacement = { x: number; y: number; z: number; opacity: number };
export type PuffCloudSnapshot = {
  count: number;
  layout: PuffCloudLayout[];
  placements: PuffCloudPlacement[];
  skyLight: number[];
};

type Puff = PuffCloudLayout & {
  x: number;
  z: number;
  turn: number;
  opacity: number;
  whiteness: number;
};
type Wind = { x: number; z: number; speed: number };
type EaglePosition = { x: number; y: number; z: number };

const HALF_FIELD = PUFF_CLOUD_FIELD / 2;
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchRotation = new THREE.Quaternion();
const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();
const worldUp = new THREE.Vector3(0, 1, 0);

function randomStream(seed: number): () => number {
  let state = (seed >>> 0) ^ 0xa511e9b3;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapOffset(value: number): number {
  return ((value + HALF_FIELD) % PUFF_CLOUD_FIELD + PUFF_CLOUD_FIELD) % PUFF_CLOUD_FIELD - HALF_FIELD;
}

function createPuffGeometry(random: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const sphereCount = 7;
  for (let index = 0; index < sphereCount; index += 1) {
    const center = index === 0;
    const radius = center ? 0.28 : 0.16 + random() * 0.08;
    const angle = center ? 0 : (index - 1) * (Math.PI * 2 / 6) + (random() - 0.5) * 0.14;
    const orbit = center ? 0 : 0.17 + random() * 0.045;
    const sphere = new THREE.SphereGeometry(0.5, 14, 10);
    sphere.scale(radius * 2, radius * (1.2 + random() * 0.2) * 2, radius * 2);
    sphere.translate(center ? 0 : Math.cos(angle) * orbit, center ? 0 : (random() - 0.5) * 0.1,
      center ? 0 : Math.sin(angle) * orbit);
    parts.push(sphere);
  }

  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Could not merge puff cloud spheres');
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(1 / Math.max(size.x, size.z), 1 / Math.max(size.x, size.z), 1 / Math.max(size.x, size.z));
  geometry.computeBoundingSphere();
  return geometry;
}

/** A seeded, drifting pool of forty seven-sphere clouds in a 6.4 km wrap field. */
export class PuffClouds {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly puffs: Puff[];
  private readonly horizonColor = { value: new THREE.Color(0x8faeb8) };
  private readonly skyLight = { value: new THREE.Color(1, 1, 1) };
  private readonly lastEagle: { x: number; z: number };
  private readonly shown: PuffCloudPlacement[] = Array.from({ length: PUFF_CLOUD_COUNT }, () => ({ x: 0, y: 0, z: 0, opacity: 0 }));

  constructor(scene: THREE.Object3D, seed: number, origin: EaglePosition) {
    const random = randomStream(seed);
    const geometry = createPuffGeometry(random);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        horizonColor: this.horizonColor,
        skyLight: this.skyLight,
        puffOpacity: { value: 0.68 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: `
        varying vec3 vWorldNormal;
        varying float vViewDistance;
        varying float vPuffOpacity;
        varying float vWhiteness;
        void main() {
          vPuffOpacity = instanceColor.r;
          vWhiteness = instanceColor.g;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vViewDistance = length(mvPosition.xyz);
          vWorldNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 horizonColor;
        uniform vec3 skyLight;
        uniform float puffOpacity;
        varying vec3 vWorldNormal;
        varying float vViewDistance;
        varying float vPuffOpacity;
        varying float vWhiteness;
        void main() {
          float distanceFade = 1.0 - smoothstep(2300.0, 2900.0, vViewDistance);
          float closeFade = smoothstep(55.0, 175.0, vViewDistance);
          float facingWhite = smoothstep(-0.65, 0.45, vWorldNormal.y);
          vec3 cloudFace = skyLight * mix(0.86, 1.0, vWhiteness);
          vec3 cloudColor = mix(horizonColor, cloudFace, facingWhite);
          float alpha = puffOpacity * vPuffOpacity * distanceFade * closeFade;
          gl_FragColor = vec4(cloudColor, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.puffs = Array.from({ length: PUFF_CLOUD_COUNT }, () => {
      const offsetX = random() * PUFF_CLOUD_FIELD - HALF_FIELD;
      const offsetZ = random() * PUFF_CLOUD_FIELD - HALF_FIELD;
      return {
        offsetX,
        offsetZ,
        x: offsetX,
        z: offsetZ,
        height: PUFF_CLOUD_DECK + (random() - 0.5) * 90,
        width: 55 + random() * 95,
        driftSpeed: 2.4 + random() * 3.2,
        turn: random() * Math.PI * 2,
        opacity: 0,
        whiteness: 0.78 + random() * 0.22,
      };
    });
    this.lastEagle = { x: origin.x, z: origin.z };
    this.mesh = new THREE.InstancedMesh(geometry, material, PUFF_CLOUD_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = PUFF_CLOUD_COUNT;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    for (let index = 0; index < this.puffs.length; index += 1) {
      const puff = this.puffs[index]!;
      this.mesh.setColorAt(index, scratchColor.setRGB(0.82, puff.whiteness, 1));
    }
    this.mesh.instanceColor!.setUsage(THREE.StaticDrawUsage);
    scene.add(this.mesh);
  }

  get count(): number {
    return this.mesh.count;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  update(eagle: EaglePosition, wind: Wind, delta: number, camera: EaglePosition, horizon: THREE.Color, skyLight: THREE.Color): void {
    this.horizonColor.value.copy(horizon);
    this.skyLight.value.copy(skyLight);
    const birdDeltaX = eagle.x - this.lastEagle.x;
    const birdDeltaZ = eagle.z - this.lastEagle.z;
    for (let index = 0; index < this.puffs.length; index += 1) {
      const puff = this.puffs[index]!;
      const windScale = puff.driftSpeed / 7.2;
      puff.x = wrapOffset(puff.x + wind.x * windScale * delta - birdDeltaX);
      puff.z = wrapOffset(puff.z + wind.z * windScale * delta - birdDeltaZ);
      const worldX = eagle.x + puff.x;
      const worldZ = eagle.z + puff.z;
      const worldY = puff.height;
      const cameraDistance = Math.hypot(camera.x - worldX, camera.y - worldY, camera.z - worldZ);
      const closeScale = 0.46 + 0.54 * smoothstep(120, 500, cameraDistance);
      puff.opacity = smoothstep(55, 175, cameraDistance) * (1 - smoothstep(2300, 2900, cameraDistance));
      scratchPosition.set(worldX, worldY, worldZ);
      scratchRotation.setFromAxisAngle(worldUp, puff.turn);
      scratchScale.setScalar(puff.width * closeScale);
      scratchMatrix.compose(scratchPosition, scratchRotation, scratchScale);
      this.mesh.setMatrixAt(index, scratchMatrix);
      const shown = this.shown[index]!;
      shown.x = worldX;
      shown.y = worldY;
      shown.z = worldZ;
      shown.opacity = puff.opacity;
    }
    this.lastEagle.x = eagle.x;
    this.lastEagle.z = eagle.z;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  snapshot(): PuffCloudSnapshot {
    return {
      count: this.count,
      skyLight: this.skyLight.value.toArray(),
      layout: this.puffs.map(({ offsetX, offsetZ, height, width, driftSpeed }) => ({ offsetX, offsetZ, height, width, driftSpeed })),
      placements: this.shown.map(({ x, y, z, opacity }) => ({ x, y, z, opacity })),
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
